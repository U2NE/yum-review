package com.yumreview.review;

import com.yumreview.auth.AppUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.yumreview.review.ReviewDtos.ReviewPhotoRequest;
import static com.yumreview.review.ReviewDtos.ReviewRequest;
import static com.yumreview.review.ReviewDtos.ReviewResponse;

@RestController
public class ReviewController {
    private final ReviewService reviews;

    public ReviewController(ReviewService reviews) { this.reviews = reviews; }

    @PostMapping("/api/menus/{menuId}/reviews")
    @ResponseStatus(HttpStatus.CREATED)
    public ReviewResponse create(@PathVariable Long menuId,
                                 @AuthenticationPrincipal AppUser principal,
                                 @Valid @RequestBody ReviewRequest request) {
        return reviews.create(menuId, principal, request);
    }

    @PutMapping("/api/reviews/{reviewId}")
    public ReviewResponse update(@PathVariable Long reviewId,
                                 @AuthenticationPrincipal AppUser principal,
                                 @Valid @RequestBody ReviewRequest request) {
        return reviews.update(reviewId, principal, request);
    }

    @PostMapping("/api/reviews/{reviewId}/photos")
    @ResponseStatus(HttpStatus.CREATED)
    public ReviewResponse attachPhoto(@PathVariable Long reviewId,
                                      @AuthenticationPrincipal AppUser principal,
                                      @Valid @RequestBody ReviewPhotoRequest request) {
        return reviews.attachPhoto(reviewId, principal, request.mediaId());
    }

    @DeleteMapping("/api/reviews/{reviewId}/photos/{mediaId}")
    public ReviewResponse detachPhoto(@PathVariable Long reviewId, @PathVariable String mediaId,
                                      @AuthenticationPrincipal AppUser principal) {
        return reviews.detachPhoto(reviewId, principal, mediaId);
    }

    @DeleteMapping("/api/reviews/{reviewId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long reviewId, @AuthenticationPrincipal AppUser principal) {
        reviews.delete(reviewId, principal);
    }

    @GetMapping("/api/me/reviews")
    public List<ReviewResponse> myReviews(@AuthenticationPrincipal AppUser principal) {
        return reviews.myReviews(principal);
    }
}
