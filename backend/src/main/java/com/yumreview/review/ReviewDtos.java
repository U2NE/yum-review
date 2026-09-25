package com.yumreview.review;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class ReviewDtos {
    private ReviewDtos() { }

    public record ReviewRequest(
            @NotNull @DecimalMin("0.5") @DecimalMax("5.0") BigDecimal overallScore,
            @NotNull @DecimalMin("0.5") @DecimalMax("5.0") BigDecimal tasteScore,
            @NotNull @DecimalMin("0.5") @DecimalMax("5.0") BigDecimal valueScore,
            @NotNull @DecimalMin("0.5") @DecimalMax("5.0") BigDecimal portionScore,
            @Size(max = 1000) String comment,
            @NotNull @AssertTrue Boolean nonEventReviewConsent) { }

    public record ReviewPhotoRequest(@NotBlank @Size(max = 64) String mediaId) { }

    public record ReviewResponse(
            Long id,
            Long menuId,
            String menuName,
            Long restaurantId,
            String restaurantName,
            BigDecimal overallScore,
            BigDecimal tasteScore,
            BigDecimal valueScore,
            BigDecimal portionScore,
            String comment,
            Boolean nonEventReviewConsent,
            List<String> photoMediaIds,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
        static ReviewResponse from(Review review, List<String> photoMediaIds) {
            var menu = review.getMenu();
            var restaurant = menu.getRestaurant();
            return new ReviewResponse(review.getId(), menu.getId(), menu.getName(),
                    restaurant.getId(), restaurant.getName(), review.getOverallScore(),
                    review.getTasteScore(), review.getValueScore(), review.getPortionScore(),
                    review.getComment(), review.getNonEventReviewConsent(), List.copyOf(photoMediaIds),
                    review.getCreatedAt(), review.getUpdatedAt());
        }
    }

    public record OperationResult(String message) { }
}
