package com.yumreview.catalog;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class CatalogDtos {
    private CatalogDtos() { }

    public record MenuSearchResponse(List<MenuCard> menus, String sort, boolean radiusApplied,
                                    long unlocatedExcludedCount, String notice) { }

    public record MenuSearchRequest(String q, String category, String region,
                                    Double latitude, Double longitude, Integer radiusMeters,
                                    String sort) { }

    public record MenuCard(
            Long id, String name, String description, Integer priceKrw,
            Long restaurantId, String restaurantName, String restaurantAddress, String region,
            String cuisineCategory, String imageUrl, Double distanceMeters,
            Double overallAverage, Double tasteAverage, Double valueAverage,
            Double portionAverage, Long reviewCount) { }

    public record RestaurantDetail(Long id, String name, String description, String address,
                                   String region, List<MenuCard> menus) { }

    public record MenuDetail(
            Long id, String name, String description, Integer priceKrw,
            Long restaurantId, String restaurantName, String restaurantAddress, String region,
            String cuisineCategory, String imageUrl, Double overallAverage, Double tasteAverage,
            Double valueAverage, Double portionAverage, Long reviewCount) { }

    public record MenuManagementItem(
            Long id, Long restaurantId, String name, String description, Integer priceKrw,
            String cuisineCategory, String imageUrl, boolean active,
            Double overallAverage, Double tasteAverage, Double valueAverage,
            Double portionAverage, Long reviewCount) { }

    public record MenuWriteRequest(
            @NotBlank @Size(max = 160) String name,
            @Size(max = 1000) String description,
            @Min(0) Integer priceKrw,
            @NotNull Menu.CuisineCategory cuisineCategory,
            @Size(max = 64) String photoMediaId,
            Boolean active) { }

    public record PublicReview(Long id, String authorLabel, BigDecimal overallScore,
                               BigDecimal tasteScore, BigDecimal valueScore, BigDecimal portionScore,
                               String comment, OffsetDateTime createdAt, List<String> photoMediaIds) { }

    public record OperationResult(String message) { }
    public record ApiError(int status, String code, String message) { }
}
