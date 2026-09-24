package com.yumreview.review;

import com.yumreview.auth.AppUser;
import com.yumreview.auth.AppUserRepository;
import com.yumreview.catalog.Menu;
import com.yumreview.catalog.MenuRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static com.yumreview.review.ReviewDtos.ReviewRequest;
import static com.yumreview.review.ReviewDtos.ReviewResponse;

@Service
@Transactional
public class ReviewService {
    private final ReviewRepository reviews;
    private final MenuRepository menus;
    private final AppUserRepository users;

    public ReviewService(ReviewRepository reviews, MenuRepository menus, AppUserRepository users) {
        this.reviews = reviews;
        this.menus = menus;
        this.users = users;
    }

    public ReviewResponse create(Long menuId, AppUser principal, ReviewRequest request) {
        Menu menu = menus.findById(menuId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "메뉴를 찾을 수 없습니다."));

        if (reviews.existsByUser_IdAndMenu_Id(principal.getId(), menuId)) {
            throw duplicateReview();
        }

        AppUser author = users.getReferenceById(principal.getId());
        Review review = new Review(author, menu, request);
        try {
            return ReviewResponse.from(reviews.saveAndFlush(review));
        } catch (DataIntegrityViolationException exception) {
            // The database constraint is the final guard for concurrent duplicate writes.
            // Do not expose constraint names, SQL or submitted data in the response.
            if (isDuplicateReviewViolation(exception)) throw duplicateReview();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "리뷰를 저장하지 못했습니다.");
        }
    }

    public ReviewResponse update(Long reviewId, AppUser principal, ReviewRequest request) {
        Review review = requireOwnedReview(reviewId, principal);
        review.apply(request);
        try {
            return ReviewResponse.from(reviews.saveAndFlush(review));
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "리뷰를 저장하지 못했습니다.");
        }
    }

    public void delete(Long reviewId, AppUser principal) {
        Review review = requireOwnedReview(reviewId, principal);
        reviews.delete(review);
        reviews.flush();
    }

    @Transactional(readOnly = true)
    public List<ReviewResponse> myReviews(AppUser principal) {
        return reviews.findAllByUser_IdOrderByUpdatedAtDesc(principal.getId()).stream()
                .map(ReviewResponse::from)
                .toList();
    }

    private Review requireOwnedReview(Long reviewId, AppUser principal) {
        Review review = reviews.findById(reviewId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없습니다."));
        if (!review.getUser().getId().equals(principal.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인이 작성한 리뷰만 변경할 수 있습니다.");
        }
        return review;
    }

    private static ResponseStatusException duplicateReview() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "이 메뉴에는 이미 리뷰를 작성했습니다.");
    }

    private static boolean isDuplicateReviewViolation(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof org.hibernate.exception.ConstraintViolationException violation
                    && "uq_review_user_menu".equals(violation.getConstraintName())) {
                return true;
            }
        }
        return false;
    }
}
