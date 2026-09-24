package com.yumreview.catalog;

import java.time.OffsetDateTime;
import java.util.List;

public final class CatalogDtos {
    private CatalogDtos() {}

    public record MenuCard(
            Long id, String name, String description, Integer priceKrw,
            Long restaurantId, String restaurantName,
            Double overallAverage, Double tasteAverage, Double valueAverage,
            Double portionAverage, Long reviewCount) {}

    public record RestaurantDetail(
            Long id, String name, String description, String address, List<MenuCard> menus) {}

    public record MenuDetail(
            Long id, String name, String description, Integer priceKrw,
            Long restaurantId, String restaurantName, String restaurantAddress,
            Double overallAverage, Double tasteAverage, Double valueAverage,
            Double portionAverage, Long reviewCount) {}

    public record PublicReview(
            Long id, String authorLabel, Integer overallScore, Integer tasteScore,
            Integer valueScore, Integer portionScore, String comment, OffsetDateTime createdAt) {}

    public record ApiError(int status, String code, String message) {}
}
