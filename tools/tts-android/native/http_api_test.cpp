#include "http_api.h"

#include <atomic>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <thread>

using namespace townpass_tts;

static void check(bool ok, const char * message) {
    if (!ok) { std::cerr << "FAIL: " << message << '\n'; std::exit(1); }
}

int main() {
    const std::string key(64, 'a');
    httplib::Headers auth{{"Authorization", "Bearer " + key}};
    std::atomic<int> calls{0};
    std::mutex gate;
    std::condition_variable cv;
    bool entered = false, release = false;
    httplib::Server server;
    install_api(server, key, [&](const std::string & text) {
        ++calls;
        if (text == "wait") {
            std::unique_lock<std::mutex> lock(gate);
            entered = true;
            cv.notify_all();
            cv.wait(lock, [&] { return release; });
        }
        Audio result;
        result.sample_rate = 48000;
        result.channels = 1;
        result.pcm = {0.0f, 0.5f, -0.5f, 1.0f};
        result.stop_reason = "stop_head";
        return result;
    });
    const int port = server.bind_to_any_port("127.0.0.1");
    check(port > 0, "bind loopback");
    std::thread worker([&] { server.listen_after_bind(); });
    httplib::Client client("127.0.0.1", port);
    client.set_read_timeout(5);
    const std::string body = R"({"model":"bluemagpie-q8_0","input":"您好，這是測試。","voice":"default","response_format":"wav"})";
    auto post = [&](const std::string & input, const httplib::Headers & headers) {
        return client.Post("/v1/audio/speech", headers, input, "application/json");
    };
    auto no_key = post(body, {});
    check(no_key && no_key->status == 401, "missing key rejected");
    auto wrong_key = post(body, {{"Authorization", "Bearer wrong"}});
    check(wrong_key && wrong_key->status == 401, "wrong key rejected");
    check(calls == 0, "unauthorized requests never synthesize");
    auto models = client.Get("/v1/models", auth);
    check(models && models->status == 200 && models->body.find(kModel) != std::string::npos, "authenticated readiness");
    auto forbidden = auth;
    forbidden.emplace("Origin", "https://evil.example");
    auto denied = post(body, forbidden);
    check(denied && denied->status == 403 && !denied->has_header("Access-Control-Allow-Origin"), "origin rejected");
    auto preflight = client.Options("/v1/audio/speech", {{"Origin", "http://localhost:5173"}, {"Access-Control-Request-Method", "POST"}, {"Access-Control-Request-Headers", "authorization, content-type"}});
    check(preflight && preflight->status == 204 && preflight->get_header_value("Access-Control-Allow-Origin") == "http://localhost:5173", "allowlisted preflight without key");
    auto evil_options = client.Options("/v1/audio/speech", {{"Origin", "null"}, {"Access-Control-Request-Method", "POST"}});
    check(evil_options && evil_options->status == 403, "null origin rejected");
    const std::vector<std::string> invalid = {
        "null", "[]", "{", R"({"model":"wrong","input":"test"})",
        R"({"model":"bluemagpie-q8_0","input":""})",
        R"({"model":"bluemagpie-q8_0","input":"　\n\t"})",
        R"({"model":"bluemagpie-q8_0","input":4})",
        R"({"model":"bluemagpie-q8_0","input":"a\u0000b"})",
        R"({"model":"bluemagpie-q8_0","input":"<|audio_start|>"})",
        R"({"model":"bluemagpie-q8_0","input":"test","voice":"alloy"})",
        R"({"model":"bluemagpie-q8_0","input":"test","voice":null})",
        R"({"model":"bluemagpie-q8_0","input":"test","response_format":"mp3"})",
        R"({"model":"bluemagpie-q8_0","input":"test","reference_audio":"/private/file.wav"})",
        R"({"model":"bluemagpie-q8_0","input":"test","speed":1.0})",
        R"({"model":"bluemagpie-q8_0","input":"test","max_frames":1000})",
        std::string(R"({"model":"bluemagpie-q8_0","input":")") + std::string(81, 'x') + "\"}",
    };
    for (const auto & input : invalid) {
        auto response = post(input, auth);
        check(response && response->status == 400, "invalid request rejected");
    }
    check(calls == 0, "validation happens before inference");
    auto too_large = post(std::string(5000, 'x'), auth);
    check(too_large && too_large->status == 413, "body limit");
    auto no_voice_route = client.Post("/v1/audio/voices", auth, "{}", "application/json");
    check(no_voice_route && no_voice_route->status == 404, "no voice creation route");
    auto good_headers = auth;
    good_headers.emplace("Origin", "http://127.0.0.1:5173");
    auto wav = post(body, good_headers);
    check(wav && wav->status == 200 && wav->body.size() == 52, "WAV returned");
    check(wav->body.substr(0, 4) == "RIFF" && wav->body.substr(8, 4) == "WAVE", "WAV header");
    check(static_cast<unsigned char>(wav->body[4]) == 44 && static_cast<unsigned char>(wav->body[40]) == 8, "finite WAV sizes");
    check(wav->get_header_value("X-Audio-Sample-Rate") == "48000", "preserve model sample rate");
    check(wav->get_header_value("Access-Control-Allow-Origin") == "http://127.0.0.1:5173", "exact CORS");
    auto pcm = post(R"({"model":"bluemagpie-q8_0","input":"test","response_format":"pcm"})", auth);
    check(pcm && pcm->status == 200 && pcm->body.size() == 8, "PCM16 returned");
    auto case_type = client.Post("/v1/audio/speech", auth, body, "Application/JSON; charset=UTF-8");
    check(case_type && case_type->status == 200, "case-insensitive complete JSON media type");
    const auto before_type_rejection = calls.load();
    auto prefix_type = client.Post("/v1/audio/speech", auth, body, "application/jsonp");
    check(prefix_type && prefix_type->status == 415 && calls == before_type_rejection, "JSON prefix is not media type");
    std::thread pending([&] {
        httplib::Client second("127.0.0.1", port);
        second.set_read_timeout(10);
        auto response = second.Post("/v1/audio/speech", auth, R"({"model":"bluemagpie-q8_0","input":"wait"})", "application/json");
        check(response && response->status == 200, "first concurrent request completes");
    });
    {
        std::unique_lock<std::mutex> lock(gate);
        check(cv.wait_for(lock, std::chrono::seconds(5), [&] { return entered; }), "inference entered");
    }
    auto busy = post(body, auth);
    check(busy && busy->status == 429, "second inference does not queue");
    {
        std::lock_guard<std::mutex> lock(gate);
        release = true;
    }
    cv.notify_all();
    pending.join();

    // 四個有活動、但未收完的請求：兩個 header、兩個 body，皆須受整體收件期限限制。
    std::vector<socket_t> slow;
    for (int i = 0; i < 4; ++i) {
        const auto sock = ::socket(AF_INET, SOCK_STREAM, 0);
        check(sock != INVALID_SOCKET, "create slow receiver test socket");
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(static_cast<uint16_t>(port));
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        check(::connect(sock, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0, "connect slow receiver test socket");
        const std::string partial = i < 2
            ? "GET /v1/models HTTP/1.1\r\nHost: localhost\r\nX-Slow: "
            : "POST /v1/audio/speech HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer " + key + "\r\nContent-Type: application/json\r\nContent-Length: 1024\r\n\r\n{";
        check(::send(sock, partial.data(), static_cast<int>(partial.size()), CPPHTTPLIB_SEND_FLAGS) > 0, "send incomplete request");
        slow.push_back(sock);
    }
    std::atomic<bool> dripping{true};
    std::thread dripper([&] {
        while (dripping) {
            for (const auto sock : slow) ::send(sock, " ", 1, CPPHTTPLIB_SEND_FLAGS);
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
        }
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(5500));
    httplib::Client after_deadline("127.0.0.1", port);
    after_deadline.set_read_timeout(2);
    auto available = after_deadline.Get("/v1/models", auth);
    dripping = false;
    dripper.join();
    for (const auto sock : slow) {
#ifdef _WIN32
        ::closesocket(sock);
#else
        ::close(sock);
#endif
    }
    check(available && available->status == 200, "absolute header/body receive deadline releases workers");
    server.stop();
    worker.join();
    std::cout << "HTTP contract checks passed\n";
}
