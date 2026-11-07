#include "startup_protocol.h"

#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#include <windows.h>
#endif

namespace {

FILE * temporary_file() {
#ifdef _WIN32
    // MSVCRT tmpfile 會嘗試寫入磁碟根目錄；一般使用者改用系統的使用者暫存目錄。
    wchar_t directory[MAX_PATH], path[MAX_PATH];
    const DWORD length = GetTempPathW(MAX_PATH, directory);
    if (length == 0 || length >= MAX_PATH || !GetTempFileNameW(directory, L"tts", 0, path)) return nullptr;
    const int fd = _wopen(path, _O_RDWR | _O_BINARY | _O_TEMPORARY);
    if (fd < 0) { DeleteFileW(path); return nullptr; }
    FILE * file = _fdopen(fd, "w+b");
    if (!file) _close(fd);
    return file;
#else
    return std::tmpfile();
#endif
}

void require(bool condition) {
    if (!condition) throw std::runtime_error("startup protocol assertion failed");
}

std::string contents(FILE * file) {
    std::rewind(file);
    char buffer[256];
    const auto size = std::fread(buffer, 1, sizeof(buffer), file);
    require(size < sizeof(buffer));
    return {buffer, size};
}

}  // namespace

int main() {
    // 使用真實 descriptor 重導，確認上游 printf/cout 不會污染 ProcessBuilder 的 stdout pipe。
    FILE * protocol = temporary_file();
    FILE * diagnostics = temporary_file();
    if (!protocol || !diagnostics) {
        std::perror("temporary_file");
        if (protocol) std::fclose(protocol);
        if (diagnostics) std::fclose(diagnostics);
        return 1;
    }
    const int saved_stdout = townpass_tts::startup_detail::duplicate(fileno(stdout));
    const int saved_stderr = townpass_tts::startup_detail::duplicate(fileno(stderr));
    if (saved_stdout < 0 || saved_stderr < 0) return 1;
    int result = 0;
    try {
        require(townpass_tts::startup_detail::redirect(fileno(protocol), fileno(stdout)) >= 0);
        require(townpass_tts::startup_detail::redirect(fileno(diagnostics), fileno(stderr)) >= 0);
        {
            townpass_tts::StartupPipe pipe;
            // READY 不能早於 PID；不合法的 port 不可成為可信 endpoint。
            bool rejected = false;
            try { pipe.ready(32123); } catch (const std::exception &) { rejected = true; }
            require(rejected);
            pipe.identity();
            rejected = false;
            try { pipe.ready(0); } catch (const std::exception &) { rejected = true; }
            require(rejected);
            rejected = false;
            try { pipe.ready(65536); } catch (const std::exception &) { rejected = true; }
            require(rejected);
            std::printf("upstream printf output\n");
            std::cout << "upstream cout output\n" << std::flush;
            std::fflush(stdout);
            pipe.ready(32123);
        }
        const auto pid = std::to_string(townpass_tts::startup_detail::process_id());
        require(contents(protocol) == "TOWNPASS_TTS_V1 PID " + pid + "\nTOWNPASS_TTS_V1 READY " + pid + " 32123\n");
        const auto discarded = contents(diagnostics);
        require(discarded.find("upstream printf output") != std::string::npos);
        require(discarded.find("upstream cout output") != std::string::npos);
    } catch (...) {
        result = 1;
    }
    townpass_tts::startup_detail::redirect(saved_stdout, fileno(stdout));
    townpass_tts::startup_detail::redirect(saved_stderr, fileno(stderr));
    townpass_tts::startup_detail::close_fd(saved_stdout);
    townpass_tts::startup_detail::close_fd(saved_stderr);
    std::fclose(protocol);
    std::fclose(diagnostics);
    return result;
}
