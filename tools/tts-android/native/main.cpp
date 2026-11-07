#include "http_api.h"
#include "startup_protocol.h"
#include "tts_runner.h"
#include "llama.h"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <thread>
#ifdef __ANDROID__
#include <signal.h>
#include <sys/prctl.h>
#include <unistd.h>
#endif

namespace {

// 推論卡住時結束獨立子行程；不讓失敗工作永久占住唯一 slot。
class Deadline {
    std::mutex mutex;
    std::condition_variable cv;
    bool done = false;
    std::thread timer;
public:
    Deadline() : timer([this] {
        std::unique_lock<std::mutex> lock(mutex);
        if (!cv.wait_for(lock, std::chrono::seconds(180), [this] { return done; })) std::_Exit(124);
    }) {}
    ~Deadline() {
        { std::lock_guard<std::mutex> lock(mutex); done = true; }
        cv.notify_all();
        timer.join();
    }
};

int positive_number(const std::string & value, int max) {
    if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument("number");
    const long parsed = std::stol(value);
    if (parsed < 1 || parsed > max) throw std::invalid_argument("range");
    return static_cast<int>(parsed);
}

}  // namespace

int main(int argc, char ** argv) {
    try {
        townpass_tts::StartupPipe startup;
        codec_common::tts_runner_params params;
        int port = 0, parent = 0;
        params.n_threads = 4;
        params.use_gpu = false;
        params.n_parallel = 1;
        params.max_frames = 128;
        params.segment_bytes = 0;
        params.flow_steps = 10;
        // 固定 seed 讓研究驗證可重現；不開放網頁調整資源或取樣參數。
        params.sampling.seed = 42;
        for (int i = 1; i < argc; i += 2) {
            if (i + 1 >= argc) throw std::invalid_argument("missing argument");
            const std::string flag = argv[i], value = argv[i + 1];
            if (flag == "--model") params.codec_path = value;
            else if (flag == "--backbone") params.backbone_path = value;
            else if (flag == "--port") port = value == "0" ? 0 : positive_number(value, 65535);
            else if (flag == "--n-threads") params.n_threads = positive_number(value, 16);
            else if (flag == "--parent-pid") parent = positive_number(value, 2147483647);
            else throw std::invalid_argument("unknown argument");
        }
        if (params.codec_path.empty() || params.backbone_path.empty()) throw std::invalid_argument("missing argument");
        const char * raw_key = std::getenv("TOWNPASS_TTS_API_KEY");
        const std::string key = raw_key ? raw_key : "";
        httplib::Server server;
        // 不沿用 httplib 的 reuse socket 選項；服務持有的 port 不與其他 listener 共用。
        server.set_socket_options([](socket_t) {});
        // 在載入前驗key；未帶key的process絕不提供HTTP服務。
        if (key.size() != 64 || key.find_first_not_of("0123456789abcdef") != std::string::npos) throw std::invalid_argument("invalid key");
#ifdef __ANDROID__
        // 不留下app死亡後的孤兒服務，也不使用可能PID重用的持久pid檔。
        if (parent <= 1 || prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() != parent) return 3;
        unsetenv("TOWNPASS_TTS_API_KEY");
#endif
        // 先透過私有 pipe 提供 PID，載入卡住時 Android 仍能對這個 child 發送 SIGKILL。
        startup.identity();
        // socket 由 native 一次 bind 並持有到退出，不再由 parent 探測後釋放 free port。
        // 固定 port 僅供桌面驗證；Android 省略 --port，讓核心選 ephemeral loopback port。
        if (port == 0) port = server.bind_to_any_port("127.0.0.1");
        else if (!server.bind_to_port("127.0.0.1", port)) return 5;
        if (port <= 0) return 5;
        // 上游會把完整prompt寫入INFO，手機版不轉存任何模型/使用者內容log。
        codec_log_set([](codec_log_level, const char *, void *) {}, nullptr);
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        std::string load_error;
        std::unique_ptr<codec_common::tts_runner_session, decltype(&codec_common::tts_runner_free)> session(
            codec_common::tts_runner_load(params, &load_error), codec_common::tts_runner_free);
        if (!session) { std::cerr << "TTS_MODEL_LOAD_FAILED\n"; return 4; }
        townpass_tts::install_api(server, key, [&](const std::string & text) {
            Deadline deadline;
            auto request = params;
            request.text = text;
            codec_common::tts_runner_result result;
            if (!codec_common::tts_runner_run(session.get(), request, &result)) throw std::runtime_error("TTS_RUN_FAILED");
            return townpass_tts::Audio{std::move(result.pcm), result.sample_rate, result.n_channels, result.stop_reason};
        });
        // 完成模型載入與 bind 後才發布可信 port；EOF 後 Kotlin 才能送 authenticated models。
        startup.ready(port);
        return server.listen_after_bind() ? 0 : 5;
    } catch (...) {
        std::cerr << "TTS_START_FAILED\n";
        return 2;
    }
}
