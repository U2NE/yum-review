package com.yumreview.location;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Component
public class VWorldGeocoderClient {
    private static final String ENDPOINT = "https://api.vworld.kr/req/address";
    private static final String SEARCH_ERROR = "주소 변환 서비스에 연결하지 못했습니다. 주소를 확인한 뒤 다시 시도해 주세요.";
    private final JsonMapper json;
    private final String apiKey;
    private final HttpClient http;

    public VWorldGeocoderClient(JsonMapper json,
                                @Value("${yum-review.vworld.api-key:}") String apiKey) {
        this.json = json;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    public boolean configured() { return !apiKey.isBlank(); }

    public LocationSearchResponse forward(String rawAddress) {
        String address = rawAddress == null ? "" : rawAddress.trim();
        if (address.isBlank() || address.length() > 160) {
            return new LocationSearchResponse(configured(), false, false,
                    address.isBlank() ? "주소를 입력해 주세요." : "주소는 160자 이내로 입력해 주세요.", List.of());
        }
        if (!configured()) {
            return new LocationSearchResponse(false, false, true, "주소 변환 서비스를 사용할 수 없습니다.", List.of());
        }

        try {
            JsonNode root = request("getCoord", "ROAD", address, null);
            List<PlaceSuggestion> results = forwardResults(root, address);
            if (results.isEmpty()) {
                root = request("getCoord", "PARCEL", address, null);
                results = forwardResults(root, address);
            }
            if (results.isEmpty()) {
                return new LocationSearchResponse(true, false, false, "해당 주소의 위치를 찾지 못했습니다.", List.of());
            }
            return new LocationSearchResponse(true, true, false, null, List.copyOf(results));
        } catch (IOException exception) {
            return new LocationSearchResponse(true, false, true, SEARCH_ERROR, List.of());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new LocationSearchResponse(true, false, true, "주소 변환이 중단됐습니다. 다시 시도해 주세요.", List.of());
        }
    }

    public ReverseGeocodeResponse reverse(Double latitude, Double longitude) {
        if (!validCoordinates(latitude, longitude)) {
            return new ReverseGeocodeResponse(configured(), false, false, "위치 좌표를 확인해 주세요.", null);
        }
        if (!configured()) return new ReverseGeocodeResponse(false, false, true, "주소 변환 서비스를 사용할 수 없습니다.", null);

        try {
            JsonNode root = request("getAddress", "both", null, longitude + "," + latitude);
            List<JsonNode> results = responseResults(root);
            JsonNode chosen = results.stream()
                    .filter(item -> "road".equalsIgnoreCase(item.path("type").asText()))
                    .filter(item -> !item.path("text").asText("").isBlank())
                    .findFirst()
                    .orElseGet(() -> results.stream()
                            .filter(item -> !item.path("text").asText("").isBlank())
                            .findFirst().orElse(null));
            if (chosen == null) return new ReverseGeocodeResponse(true, false, false, "현재 위치의 주소를 찾지 못했습니다.", null);
            String address = chosen.path("text").asText("").trim();
            return new ReverseGeocodeResponse(true, true, false, null, address);
        } catch (IOException exception) {
            return new ReverseGeocodeResponse(true, false, true, SEARCH_ERROR, null);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new ReverseGeocodeResponse(true, false, true, "주소 변환이 중단됐습니다. 다시 시도해 주세요.", null);
        }
    }

    private JsonNode request(String operation, String type, String address, String point)
            throws IOException, InterruptedException {
        StringBuilder query = new StringBuilder(ENDPOINT)
                .append("?service=address&request=").append(encode(operation))
                .append("&version=2.0&format=json&crs=epsg%3A4326")
                .append("&type=").append(encode(type))
                .append("&key=").append(encode(apiKey));
        if (address != null) query.append("&address=").append(encode(address));
        if (point != null) query.append("&point=").append(encode(point));
        HttpRequest request = HttpRequest.newBuilder(URI.create(query.toString()))
                .timeout(Duration.ofMillis(6500))
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
                .GET().build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw new IOException("provider request failed");
        return json.readTree(response.body());
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static List<JsonNode> responseResults(JsonNode root) throws IOException {
        if (root == null || !root.isObject()) throw new IOException("malformed provider response");
        JsonNode response = root.get("response");
        if (response == null || !response.isObject()) throw new IOException("malformed provider response");
        JsonNode status = response.get("status");
        if (status == null || !status.isTextual() || !"OK".equals(status.asText())) {
            throw new IOException("provider reported an error");
        }
        JsonNode result = response.get("result");
        if (result == null || result.isNull()) throw new IOException("malformed provider response");
        List<JsonNode> values = new ArrayList<>();
        if (result.isArray()) {
            for (JsonNode item : result) {
                if (!item.isObject()) throw new IOException("malformed provider response");
                values.add(item);
            }
        }
        else if (result.isObject()) values.add(result);
        else throw new IOException("malformed provider response");
        return values;
    }

    private static List<PlaceSuggestion> forwardResults(JsonNode root, String address) throws IOException {
        List<PlaceSuggestion> results = new ArrayList<>();
        for (JsonNode item : responseResults(root)) {
            JsonNode point = item.path("point");
            Double longitude = coordinate(point.path("x").asText(null), 180);
            Double latitude = coordinate(point.path("y").asText(null), 90);
            if (!validCoordinates(latitude, longitude)) continue;
            String resolved = item.path("text").asText("").trim();
            String label = resolved.isBlank() ? address : resolved;
            results.add(new PlaceSuggestion(label, "", label, label, "", latitude, longitude));
        }
        return results;
    }

    private static Double coordinate(String raw, double maximum) {
        if (raw == null || raw.isBlank()) return null;
        try {
            double value = Double.parseDouble(raw);
            return Double.isFinite(value) && value >= -maximum && value <= maximum ? value : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static boolean validCoordinates(Double latitude, Double longitude) {
        return latitude != null && longitude != null
                && Double.isFinite(latitude) && Double.isFinite(longitude)
                && latitude >= -90 && latitude <= 90
                && longitude >= -180 && longitude <= 180;
    }

    public record LocationSearchResponse(boolean configured, boolean success, boolean retryable,
                                         String message, List<PlaceSuggestion> results) { }

    public record ReverseGeocodeResponse(boolean configured, boolean success, boolean retryable,
                                         String message, String address) { }

    public record PlaceSuggestion(String name, String category, String address, String roadAddress,
                                  String sourceUrl, Double latitude, Double longitude) { }
}
