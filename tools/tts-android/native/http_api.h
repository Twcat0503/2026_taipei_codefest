#pragma once

#include "httplib.h"
#include "nlohmann/json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace townpass_tts {

inline constexpr const char * kModel = "bluemagpie-q8_0";
inline constexpr size_t kMaxBody = 4096;
inline constexpr size_t kMaxCharacters = 80;
inline constexpr size_t kMaxSamples = 48000 * 30;

struct Audio {
    std::vector<float> pcm;
    int sample_rate = 0;
    int channels = 1;
    std::string stop_reason;
};

inline bool allowed_origin(const std::string & origin) {
    return origin == "http://10.0.2.2:5173" || origin == "http://localhost:5173" ||
           origin == "http://127.0.0.1:5173";
}

inline bool same_key(const std::string & actual, const std::string & expected) {
    if (actual.size() != expected.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < expected.size(); ++i) diff |= actual[i] ^ expected[i];
    return diff == 0;
}

inline void error(httplib::Response & response, int status, const char * code) {
    response.status = status;
    response.set_content(nlohmann::json({{"error", {{"code", code}, {"message", code}}}}).dump(), "application/json");
}

// JSON parser 已驗證 UTF-8；此處計算 scalar，阻擋控制字元及模型特殊 token。
inline bool valid_text(const std::string & text) {
    if (text.empty() || text.size() > kMaxCharacters * 4 || text.find_first_of("<>") != std::string::npos) return false;
    size_t count = 0;
    bool has_text = false;
    for (size_t i = 0; i < text.size();) {
        uint32_t cp = static_cast<unsigned char>(text[i++]);
        int extra = 0;
        if (cp >= 0xF0) { cp &= 7; extra = 3; }
        else if (cp >= 0xE0) { cp &= 15; extra = 2; }
        else if (cp >= 0xC0) { cp &= 31; extra = 1; }
        if (i + extra > text.size()) return false;
        while (extra--) cp = (cp << 6) | (static_cast<unsigned char>(text[i++]) & 63);
        if (++count > kMaxCharacters) return false;
        if ((cp < 32 && cp != 9 && cp != 10 && cp != 13) || (cp >= 0x7F && cp <= 0x9F && cp != 0x85)) return false;
        const bool space = cp == 32 || cp == 9 || cp == 10 || cp == 13 || cp == 0x85 || cp == 0xA0 ||
            cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 || cp == 0x2029 ||
            cp == 0x202F || cp == 0x205F || cp == 0x3000;
        has_text |= !space;
    }
    return has_text;
}

inline void append_le(std::string & out, uint32_t value, int bytes) {
    for (int i = 0; i < bytes; ++i) out.push_back(static_cast<char>((value >> (8 * i)) & 255));
}

inline std::string encode_audio(const Audio & audio, bool wav) {
    if (audio.channels != 1 || audio.sample_rate != 48000 || audio.pcm.empty() || audio.pcm.size() > kMaxSamples ||
        audio.stop_reason != "stop_head") throw std::runtime_error("TTS_INCOMPLETE_AUDIO");
    std::string data;
    data.reserve(audio.pcm.size() * 2 + (wav ? 44 : 0));
    const uint32_t size = static_cast<uint32_t>(audio.pcm.size() * 2);
    if (wav) {
        data += "RIFF"; append_le(data, size + 36, 4); data += "WAVEfmt ";
        append_le(data, 16, 4); append_le(data, 1, 2); append_le(data, 1, 2);
        append_le(data, audio.sample_rate, 4); append_le(data, audio.sample_rate * 2, 4);
        append_le(data, 2, 2); append_le(data, 16, 2); data += "data"; append_le(data, size, 4);
    }
    for (float sample : audio.pcm) {
        if (!std::isfinite(sample)) throw std::runtime_error("TTS_INVALID_AUDIO");
        const int value = static_cast<int>(std::lround(std::clamp(sample, -1.0f, 1.0f) * 32767.0f));
        append_le(data, static_cast<uint16_t>(value), 2);
    }
    return data;
}

inline bool json_content_type(const std::string & value) {
    auto type = value.substr(0, value.find(';'));
    const auto first = type.find_first_not_of(" \t");
    if (first == std::string::npos) return false;
    type = type.substr(first, type.find_last_not_of(" \t") - first + 1);
    for (char & ch : type) if (ch >= 'A' && ch <= 'Z') ch += 'a' - 'A';
    return type == "application/json";
}

// 唯一公開的合成邊界：無音色建立、路徑、URL、取樣或任意模型參數。
inline void install_api(httplib::Server & server, const std::string & key,
                        std::function<Audio(const std::string &)> synthesize) {
    if (key.size() != 64 || key.find_first_not_of("0123456789abcdef") != std::string::npos)
        throw std::invalid_argument("TTS_INVALID_KEY");
    auto gate = std::make_shared<std::mutex>();
    server.new_task_queue = [] { return new httplib::ThreadPool(4, 4, 8); };
    server.set_payload_max_length(kMaxBody);
    server.set_read_timeout(5);
    server.set_write_timeout(10);
    server.set_keep_alive_max_count(1);
    server.set_default_headers({{"Cache-Control", "no-store"}, {"X-Content-Type-Options", "nosniff"}});
    server.set_pre_routing_handler([key](const httplib::Request & request, httplib::Response & response) {
        const auto origin = request.get_header_value("Origin");
        if (request.has_header("Origin") && !allowed_origin(origin)) {
            error(response, 403, "TTS_ORIGIN_NOT_ALLOWED");
            return httplib::Server::HandlerResponse::Handled;
        }
        if (!origin.empty()) {
            response.set_header("Access-Control-Allow-Origin", origin);
            response.set_header("Vary", "Origin");
            response.set_header("Access-Control-Expose-Headers", "X-Audio-Sample-Rate, X-Audio-Channels");
        }
        if (request.method == "OPTIONS") {
            const auto method = request.get_header_value("Access-Control-Request-Method");
            if (!origin.empty() && ((request.path == "/v1/audio/speech" && method == "POST") ||
                                   (request.path == "/v1/models" && method == "GET"))) {
                response.status = 204;
                response.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                response.set_header("Access-Control-Allow-Headers", "Authorization, Content-Type");
                if (request.get_header_value("Access-Control-Request-Private-Network") == "true")
                    response.set_header("Access-Control-Allow-Private-Network", "true");
            } else error(response, 403, "TTS_PREFLIGHT_NOT_ALLOWED");
            return httplib::Server::HandlerResponse::Handled;
        }
        if (!same_key(request.get_header_value("Authorization"), "Bearer " + key)) {
            error(response, 401, "TTS_UNAUTHORIZED");
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
    });
    server.Get("/v1/models", [](const httplib::Request &, httplib::Response & response) {
        response.set_content(nlohmann::json({{"object", "list"}, {"data", {{{"id", kModel}, {"object", "model"}}}}}).dump(), "application/json");
    });
    server.Post("/v1/audio/speech", [gate, synthesize](const httplib::Request & request, httplib::Response & response) {
        if (!json_content_type(request.get_header_value("Content-Type"))) {
            error(response, 415, "TTS_JSON_REQUIRED"); return;
        }
        bool too_deep = false;
        auto body = nlohmann::json::parse(request.body, [&](int depth, nlohmann::json::parse_event_t, nlohmann::json &) {
            too_deep |= depth > 8;
            return depth <= 8;
        }, false);
        bool valid = !too_deep && body.is_object();
        if (valid) {
            for (auto it = body.begin(); it != body.end(); ++it) {
                if (it.key() != "model" && it.key() != "input" && it.key() != "voice" && it.key() != "response_format") valid = false;
                if (!it.value().is_string()) valid = false;
            }
            valid = valid && body.contains("model") && body.contains("input");
        }
        if (valid) valid = body["model"] == kModel && valid_text(body["input"].get<std::string>()) &&
                          (!body.contains("voice") || body["voice"] == "default") &&
                          (!body.contains("response_format") || body["response_format"] == "wav" || body["response_format"] == "pcm");
        if (!valid) { error(response, 400, "TTS_INVALID_REQUEST"); return; }
        std::unique_lock<std::mutex> lock(*gate, std::try_to_lock);
        if (!lock.owns_lock()) { error(response, 429, "TTS_BUSY"); return; }
        try {
            const auto audio = synthesize(body["input"].get<std::string>());
            const bool wav = body.value("response_format", "wav") == "wav";
            response.set_content(encode_audio(audio, wav), wav ? "audio/wav" : "application/octet-stream");
            response.set_header("X-Audio-Sample-Rate", std::to_string(audio.sample_rate));
            response.set_header("X-Audio-Channels", "1");
        } catch (...) {
            error(response, 502, "TTS_SYNTHESIS_FAILED");
        }
    });
}

}  // namespace townpass_tts
