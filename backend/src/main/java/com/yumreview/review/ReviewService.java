package com.yumreview.review;

import com.yumreview.auth.AppUser;
import com.yumreview.auth.AppUserRepository;
import com.yumreview.auth.RestaurantOwnerRepository;
import com.yumreview.catalog.Menu;
import com.yumreview.catalog.MenuRepository;
import com.yumreview.media.ImageLifecycleService;
import com.yumreview.media.ImageStorageService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static com.yumreview.review.ReviewDtos.ReviewRequest;
import static com.yumreview.review.ReviewDtos.ReviewResponse;

@Service
@Transactional
public class ReviewService {
    private static final BigDecimal MIN_SCORE = new BigDecimal("0.5");
    private static final BigDecimal MAX_SCORE = new BigDecimal("5.0");
    private static final BigDecimal HALF_STEP = new BigDecimal("0.5");
    private static final int MAX_REVIEW_PHOTOS = 5;

    private final ReviewRepository reviews;
    private final MenuRepository menus;
    private final AppUserRepository users;
    private final RestaurantOwnerRepository owners;
    private final ImageLifecycleService images;

    public ReviewService(ReviewRepository reviews, MenuRepository menus, AppUserRepository users,
                         RestaurantOwnerRepository owners,
                         ImageLifecycleService images) {
        this.reviews = reviews;
        this.menus = menus;
        this.users = users;
        this.owners = owners;
        this.images = images;
    }

    public ReviewResponse create(Long menuId, AppUser principal, ReviewRequest request) {
        validateRequest(principal, request);
        Menu menu = menus.findById(menuId)
                .filter(Menu::isActive)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "메뉴를 찾을 수 없습니다."));

        if (reviews.existsByUser_IdAndMenu_Id(principal.getId(), menuId)) throw duplicateReview();

        AppUser author = users.getReferenceById(principal.getId());
        Review review = new Review(author, menu, request);
        try {
            Review saved = reviews.saveAndFlush(review);
            return ReviewResponse.from(saved, List.of());
        } catch (DataIntegrityViolationException exception) {
            if (isDuplicateReviewViolation(exception)) throw duplicateReview();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "리뷰를 저장하지 못했습니다.");
        }
    }

    public ReviewResponse update(Long reviewId, AppUser principal, ReviewRequest request) {
        validateRequest(principal, request);
        Review review = requireOwnedReview(reviewId, principal);
        review.apply(request);
        try {
            Review saved = reviews.saveAndFlush(review);
            return ReviewResponse.from(saved, reviews.findPhotoMediaIds(saved.getId()));
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "리뷰를 저장하지 못했습니다.");
        }
    }

    public ReviewResponse attachPhoto(Long reviewId, AppUser principal, String rawMediaId) {
        Review review = reviews.findLockedById(reviewId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없습니다."));
        requireAuthor(review, principal);
        String mediaId = normalizeMediaId(rawMediaId);
        long photoCount = reviews.countPhotos(reviewId);
        if (photoCount >= MAX_REVIEW_PHOTOS) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "리뷰 사진은 최대 5장까지 등록할 수 있습니다.");
        }

        // Keep the uploaded image claim and association insert in this locked review transaction.
        images.requireAttachableBy(mediaId, principal, ImageStorageService.MediaKind.REVIEW);
        try {
            reviews.attachPhoto(reviewId, mediaId, (int) photoCount);
        } catch (DataIntegrityViolationException conflict) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 연결됐거나 사용할 수 없는 사진입니다.");
        }
        return ReviewResponse.from(review, reviews.findPhotoMediaIds(reviewId));
    }

    public ReviewResponse detachPhoto(Long reviewId, AppUser principal, String mediaId) {
        Review review = reviews.findLockedById(reviewId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없습니다."));
        requireAuthor(review, principal);
        String normalizedMediaId = normalizeMediaId(mediaId);
        int removed = reviews.detachPhoto(reviewId, normalizedMediaId);
        if (removed == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰에 연결된 사진을 찾을 수 없습니다.");
        }
        images.scheduleDeletion(normalizedMediaId);
        return ReviewResponse.from(review, reviews.findPhotoMediaIds(reviewId));
    }

    public void delete(Long reviewId, AppUser principal) {
        Review review = reviews.findLockedById(reviewId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없습니다."));
        requireSignedIn(principal);
        if (!principal.isServerAdmin() && owners.existsByIdUserId(principal.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "업주 계정은 리뷰를 삭제할 수 없습니다.");
        }
        if (!principal.isServerAdmin()
                && !Objects.equals(review.getUser().getId(), principal.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인 리뷰 또는 서버 관리자만 삭제할 수 있습니다.");
        }

        List<String> mediaIds = reviews.findPhotoMediaIds(reviewId);
        reviews.detachAllPhotos(reviewId);
        for (String mediaId : mediaIds) images.scheduleDeletion(mediaId);
        reviews.delete(review);
        reviews.flush();
    }

    @Transactional(readOnly = true)
    public List<ReviewResponse> myReviews(AppUser principal) {
        requireSignedIn(principal);
        List<Review> ownReviews = reviews.findAllByUser_IdOrderByUpdatedAtDesc(principal.getId());
        if (ownReviews.isEmpty()) return List.of();

        List<Long> ids = ownReviews.stream().map(Review::getId).toList();
        Map<Long, List<String>> photoIdsByReview = new HashMap<>();
        for (ReviewRepository.ReviewPhotoRow row : reviews.findPhotoRows(ids)) {
            photoIdsByReview.computeIfAbsent(row.getReviewId(), ignored -> new ArrayList<>()).add(row.getMediaId());
        }
        return ownReviews.stream()
                .map(review -> ReviewResponse.from(review,
                        photoIdsByReview.getOrDefault(review.getId(), List.of())))
                .toList();
    }

    private Review requireOwnedReview(Long reviewId, AppUser principal) {
        requireSignedIn(principal);
        Review review = reviews.findById(reviewId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없습니다."));
        requireAuthor(review, principal);
        return review;
    }

    private static void requireAuthor(Review review, AppUser principal) {
        if (principal == null || !Objects.equals(review.getUser().getId(), principal.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "리뷰 작성자만 사진을 관리할 수 있습니다.");
        }
    }

    private static void requireSignedIn(AppUser principal) {
        if (principal == null || principal.getId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
        }
    }

    private static void validateRequest(AppUser principal, ReviewRequest request) {
        requireSignedIn(principal);
        if (request == null || !Boolean.TRUE.equals(request.nonEventReviewConsent())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "리뷰 이벤트에 참여하지 않았다는 동의가 필요합니다.");
        }
        validateScore(request.overallScore());
        validateScore(request.tasteScore());
        validateScore(request.valueScore());
        validateScore(request.portionScore());
    }

    private static void validateScore(BigDecimal score) {
        if (score == null || score.compareTo(MIN_SCORE) < 0 || score.compareTo(MAX_SCORE) > 0
                || score.remainder(HALF_STEP).compareTo(BigDecimal.ZERO) != 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "별점은 0.5점부터 5점까지 0.5점 단위로 입력해 주세요.");
        }
    }

    private static String normalizeMediaId(String mediaId) {
        if (mediaId == null || mediaId.isBlank() || mediaId.trim().length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진 식별자를 확인해 주세요.");
        }
        return mediaId.trim();
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
