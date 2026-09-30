package com.yumreview.location;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/api/location")
public class LocationSearchController {
    private static final int WINDOW_SECONDS = 60;
    private static final int REQUESTS_PER_WINDOW = 20;
    private static final String FIXED_WINDOW_SCRIPT = String.join("\n",
            "local current = redis.call('INCR', KEYS[1])",
            "if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
            "return { current, redis.call('TTL', KEYS[1]) }");

    private final VWorldGeocoderClient geocoder;
    private final JsonMapper json;
    private final URI limiterEndpoint;
    private final String limiterToken;
    private final HttpClient limiterHttp;

    public LocationSearchController(
            VWorldGeocoderClient geocoder,
            JsonMapper json,
            @Value("${yum-review.location-rate-limit.url:}") String limiterUrl,
            @Value("${yum-review.location-rate-limit.token:}") String limiterToken) {
        this.geocoder = geocoder;
        this.json = json;
        this.limiterEndpoint = validLimiterEndpoint(limiterUrl);
        this.limiterToken = limiterToken == null ? "" : limiterToken.trim();
        this.limiterHttp = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    }

    @GetMapping("/search")
    public ResponseEntity<VWorldGeocoderClient.LocationSearchResponse> search(
            @RequestParam("q") String rawAddress,
            HttpServletRequest request) {
        String address = rawAddress == null ? "" : rawAddress.trim();
        if (address.isBlank() || address.length() > 160) {
            return noStore(HttpStatus.BAD_REQUEST, geocoder.forward(address));
        }
        if (!geocoder.configured()) {
            return noStore(HttpStatus.SERVICE_UNAVAILABLE, geocoder.forward(address));
        }

        QuotaDecision quota = consumeLocationQuota(request.getRemoteAddr());
        if (quota.state() == QuotaState.UNAVAILABLE) {
            return noStore(HttpStatus.SERVICE_UNAVAILABLE, new VWorldGeocoderClient.LocationSearchResponse(
                    true, false, true, "위치 검색 보호 설정을 사용할 수 없습니다.", List.of()));
        }
        if (quota.state() == QuotaState.LIMITED) {
            return limited(new VWorldGeocoderClient.LocationSearchResponse(
                    true, false, true, "위치 검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.", List.of()), quota.retryAfterSeconds());
        }

        var result = geocoder.forward(address);
        return noStore(responseStatus(result.configured(), result.success(), result.retryable()), result);
    }

    @PostMapping("/reverse")
    public ResponseEntity<VWorldGeocoderClient.ReverseGeocodeResponse> reverse(
            @RequestBody(required = false) LocationCoordinateRequest requestBody,
            HttpServletRequest request) {
        if (requestBody == null || !validCoordinates(requestBody.latitude(), requestBody.longitude())) {
            return noStore(HttpStatus.BAD_REQUEST, new VWorldGeocoderClient.ReverseGeocodeResponse(
                    geocoder.configured(), false, false, "위치 좌표를 확인해 주세요.", null));
        }
        if (!geocoder.configured()) {
            return noStore(HttpStatus.SERVICE_UNAVAILABLE, new VWorldGeocoderClient.ReverseGeocodeResponse(
                    false, false, true, "주소 변환 서비스를 사용할 수 없습니다.", null));
        }

        QuotaDecision quota = consumeLocationQuota(request.getRemoteAddr());
        if (quota.state() == QuotaState.UNAVAILABLE) {
            return noStore(HttpStatus.SERVICE_UNAVAILABLE, new VWorldGeocoderClient.ReverseGeocodeResponse(
                    true, false, true, "위치 검색 보호 설정을 사용할 수 없습니다.", null));
        }
        if (quota.state() == QuotaState.LIMITED) {
            return limited(new VWorldGeocoderClient.ReverseGeocodeResponse(
                    true, false, true, "위치 검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.", null), quota.retryAfterSeconds());
        }

        var result = geocoder.reverse(requestBody.latitude(), requestBody.longitude());
        return noStore(responseStatus(result.configured(), result.success(), result.retryable()), result);
    }

    private QuotaDecision consumeLocationQuota(String remoteAddress) {
        if (limiterEndpoint == null || limiterToken.isBlank() || !isLiteralIp(remoteAddress)) {
            return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
        }

        try {
            String identifier = sha256(remoteAddress);
            String key = "yum:location-search:v1:" + identifier;
            String body = json.writeValueAsString(List.of("EVAL", FIXED_WINDOW_SCRIPT, 1, key, WINDOW_SECONDS));
            HttpRequest limiterRequest = HttpRequest.newBuilder(limiterEndpoint)
                    .timeout(Duration.ofSeconds(3))
                    .header("Authorization", "Bearer " + limiterToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = limiterHttp.send(limiterRequest,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
            }

            JsonNode result = json.readTree(response.body()).path("result");
            if (!result.isArray() || result.size() < 2
                    || !result.get(0).canConvertToLong() || !result.get(1).canConvertToLong()) {
                return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
            }
            long count = result.get(0).longValue();
            long ttl = result.get(1).longValue();
            if (count < 1 || ttl < 0) return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
            if (count > REQUESTS_PER_WINDOW) {
                int retryAfter = (int) Math.max(1, Math.min(WINDOW_SECONDS, ttl));
                return new QuotaDecision(QuotaState.LIMITED, retryAfter);
            }
            return new QuotaDecision(QuotaState.ALLOWED, 0);
        } catch (IOException exception) {
            return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
        } catch (RuntimeException exception) {
            return new QuotaDecision(QuotaState.UNAVAILABLE, 0);
        }
    }

    private static URI validLimiterEndpoint(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            URI uri = URI.create(raw.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || !host.toLowerCase(Locale.ROOT).endsWith(".upstash.io")
                    || (uri.getPort() != -1 && uri.getPort() != 443)
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))) {
                return null;
            }
            return uri;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private static boolean isLiteralIp(String address) {
        if (address == null || address.isBlank() || address.length() > 64 || address.indexOf('%') >= 0) return false;
        if (address.indexOf(':') >= 0) {
            try {
                return InetAddress.getByName(address) instanceof Inet6Address;
            } catch (IOException invalid) {
                return false;
            }
        }
        String[] octets = address.split("\\.", -1);
        if (octets.length != 4) return false;
        for (String octet : octets) {
            if (octet.isEmpty() || octet.length() > 3 || (octet.length() > 1 && octet.startsWith("0"))) return false;
            try {
                int value = Integer.parseInt(octet);
                if (value < 0 || value > 255) return false;
            } catch (NumberFormatException invalid) {
                return false;
            }
        }
        return true;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static boolean validCoordinates(Double latitude, Double longitude) {
        return latitude != null && longitude != null
                && Double.isFinite(latitude) && Double.isFinite(longitude)
                && latitude >= -90 && latitude <= 90
                && longitude >= -180 && longitude <= 180;
    }

    private static HttpStatus responseStatus(boolean configured, boolean success, boolean retryable) {
        if (!configured) return HttpStatus.SERVICE_UNAVAILABLE;
        if (success) return HttpStatus.OK;
        return retryable ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST;
    }

    private static <T> ResponseEntity<T> noStore(HttpStatus status, T body) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                .header("Pragma", "no-cache").body(body);
    }

    private static <T> ResponseEntity<T> limited(T body, int retryAfterSeconds) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).cacheControl(CacheControl.noStore())
                .header("Pragma", "no-cache")
                .header("Retry-After", Integer.toString(retryAfterSeconds)).body(body);
    }

    private enum QuotaState { ALLOWED, LIMITED, UNAVAILABLE }
    private record QuotaDecision(QuotaState state, int retryAfterSeconds) { }

    public record LocationCoordinateRequest(Double latitude, Double longitude) { }
}
