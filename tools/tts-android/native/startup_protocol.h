#pragma once

#include <cerrno>
#include <cstdio>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <process.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace townpass_tts {
namespace startup_detail {

inline int duplicate(int fd) {
#ifdef _WIN32
    return _dup(fd);
#else
    return dup(fd);
#endif
}

inline int redirect(int from, int to) {
#ifdef _WIN32
    return _dup2(from, to);
#else
    return dup2(from, to);
#endif
}

inline void close_fd(int fd) {
#ifdef _WIN32
    _close(fd);
#else
    close(fd);
#endif
}

inline int process_id() {
#ifdef _WIN32
    return _getpid();
#else
    return static_cast<int>(getpid());
#endif
}

}  // namespace startup_detail

/**
 * 複製 ProcessBuilder 的私有 stdout pipe，再把一般 stdout 重導到 stderr。
 * codec/llama 的直接 printf/cout 也只能進入被定長丟棄的 stderr，不會污染協定。
 * 此 fd 不包含 key、路徑、模型內容或使用者輸入，READY 後立即關閉供 parent 驗 EOF。
 */
class StartupPipe {
    int fd_ = -1;
    const int pid_ = startup_detail::process_id();
    bool identified_ = false;

    void record(const std::string & value) {
        if (fd_ < 0) throw std::runtime_error("TTS_STARTUP_PIPE_FAILED");
        size_t offset = 0;
        while (offset < value.size()) {
#ifdef _WIN32
            const auto written = _write(fd_, value.data() + offset, static_cast<unsigned int>(value.size() - offset));
#else
            const auto written = write(fd_, value.data() + offset, value.size() - offset);
#endif
            if (written < 0 && errno == EINTR) continue;
            if (written <= 0) throw std::runtime_error("TTS_STARTUP_PIPE_FAILED");
            offset += static_cast<size_t>(written);
        }
    }

public:
    StartupPipe() {
        std::fflush(stdout);
        fd_ = startup_detail::duplicate(fileno(stdout));
        if (fd_ < 0) throw std::runtime_error("TTS_STARTUP_PIPE_FAILED");
#ifdef _WIN32
        const bool configured = _setmode(fd_, _O_BINARY) != -1;
#else
        const bool configured = fcntl(fd_, F_SETFD, FD_CLOEXEC) != -1;
#endif
        if (!configured || startup_detail::redirect(fileno(stderr), fileno(stdout)) < 0) {
            startup_detail::close_fd(fd_);
            fd_ = -1;
            throw std::runtime_error("TTS_STARTUP_PIPE_FAILED");
        }
    }

    StartupPipe(const StartupPipe &) = delete;
    StartupPipe & operator=(const StartupPipe &) = delete;
    ~StartupPipe() { if (fd_ >= 0) startup_detail::close_fd(fd_); }

    void identity() {
        if (identified_ || pid_ <= 1) throw std::runtime_error("TTS_STARTUP_INVALID");
        record("TOWNPASS_TTS_V1 PID " + std::to_string(pid_) + "\n");
        identified_ = true;
    }

    void ready(int port) {
        if (!identified_ || port < 1 || port > 65535) throw std::runtime_error("TTS_STARTUP_INVALID");
        record("TOWNPASS_TTS_V1 READY " + std::to_string(pid_) + " " + std::to_string(port) + "\n");
        startup_detail::close_fd(fd_);
        fd_ = -1;
    }
};

}  // namespace townpass_tts
