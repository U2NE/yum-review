package com.yumreview.review;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;

public final class ReviewDtos {
    private ReviewDtos() {
    }

    public record ReviewRequest(
            @NotNull @Min(1) @Max(5) Integer overallScore,
            @NotNull @Min(1) @Max(5) Integer tasteScore,
            @NotNull @Min(1) @Max(5) Integer valueScore,
            @NotNull @Min(1) @Max(5) Integer portionScore,
            @Size(max = 1000) String comment) {
    }

    public record ReviewResponse(
            Long id,
            Long menuId,
            String menuName,
            Long restaurantId,
            String restaurantName,
            Integer overallScore,
            Integer tasteScore,
            Integer valueScore,
            Integer portionScore,
            String comment,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
        static ReviewResponse from(Review review) {
            var menu = review.getMenu();
            var restaurant = menu.getRestaurant();
            return new ReviewResponse(review.getId(), menu.getId(), menu.getName(),
                    restaurant.getId(), restaurant.getName(), review.getOverallScore(),
                    review.getTasteScore(), review.getValueScore(), review.getPortionScore(),
                    review.getComment(), review.getCreatedAt(), review.getUpdatedAt());
        }
    }
}
