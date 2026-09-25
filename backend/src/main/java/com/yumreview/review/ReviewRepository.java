package com.yumreview.review;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    boolean existsByUser_IdAndMenu_Id(Long userId, Long menuId);

    List<Review> findAllByUser_IdOrderByUpdatedAtDesc(Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select review from Review review where review.id = :reviewId")
    Optional<Review> findLockedById(@Param("reviewId") Long reviewId);

    interface ReviewPhotoRow {
        Long getReviewId();
        String getMediaId();
    }

    @Query(value = """
            SELECT rp.review_id AS "reviewId", rp.media_id AS "mediaId"
            FROM review_photo rp
            JOIN media_asset image ON image.media_id = rp.media_id AND image.lifecycle_status = 'ACTIVE'
            WHERE rp.review_id IN (:reviewIds)
            ORDER BY rp.review_id ASC, rp.sort_order ASC, rp.media_id ASC
            """, nativeQuery = true)
    List<ReviewPhotoRow> findPhotoRows(@Param("reviewIds") List<Long> reviewIds);

    @Query(value = """
            SELECT rp.media_id AS "mediaId"
            FROM review_photo rp
            JOIN media_asset image ON image.media_id = rp.media_id AND image.lifecycle_status = 'ACTIVE'
            WHERE rp.review_id = :reviewId
            ORDER BY rp.sort_order ASC, rp.media_id ASC
            """, nativeQuery = true)
    List<String> findPhotoMediaIds(@Param("reviewId") Long reviewId);

    @Query(value = "SELECT COUNT(*) FROM review_photo WHERE review_id = :reviewId", nativeQuery = true)
    long countPhotos(@Param("reviewId") Long reviewId);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO review_photo (review_id, media_id, sort_order)
            VALUES (:reviewId, :mediaId, :sortOrder)
            """, nativeQuery = true)
    int attachPhoto(@Param("reviewId") Long reviewId, @Param("mediaId") String mediaId,
                    @Param("sortOrder") int sortOrder);

    @Modifying(flushAutomatically = true)
    @Query(value = "DELETE FROM review_photo WHERE review_id = :reviewId AND media_id = :mediaId",
            nativeQuery = true)
    int detachPhoto(@Param("reviewId") Long reviewId, @Param("mediaId") String mediaId);

    @Modifying(flushAutomatically = true)
    @Query(value = "DELETE FROM review_photo WHERE review_id = :reviewId", nativeQuery = true)
    int detachAllPhotos(@Param("reviewId") Long reviewId);
}
