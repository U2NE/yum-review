package com.yumreview.catalog;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Read-only projections over review aggregates and public review details. */
public interface PublicReviewReadRepository extends Repository<Menu, Long> {
    interface MenuAggregate {
        Long getId();
        Long getRestaurantId();
        String getRestaurantName();
        String getRestaurantAddress();
        String getRegion();
        String getName();
        String getDescription();
        Integer getPriceKrw();
        String getCuisineCategory();
        String getPhotoMediaId();
        String getPhotoUrl();
        Boolean getActive();
        Double getDistanceMeters();
        Double getOverallAverage();
        Double getTasteAverage();
        Double getValueAverage();
        Double getPortionAverage();
        Long getReviewCount();
    }

    interface PublicReviewRow {
        Long getId();
        BigDecimal getOverallScore();
        BigDecimal getTasteScore();
        BigDecimal getValueScore();
        BigDecimal getPortionScore();
        String getComment();
        Instant getCreatedAt();
        String getPhotoMediaIdsCsv();
    }

    String DISTANCE_METERS = """
            (6371000.0 * 2.0 * asin(sqrt(greatest(0.0, least(1.0,
                power(sin(radians(cast(r.latitude AS double precision) - cast(:lat AS double precision)) / 2.0), 2)
                + cos(radians(cast(:lat AS double precision)))
                  * cos(radians(cast(r.latitude AS double precision)))
                  * power(sin(radians(cast(r.longitude AS double precision) - cast(:lon AS double precision)) / 2.0), 2)
            )))))
            """;

    String AGGREGATE_SELECT = """
            SELECT m.id AS "id", r.id AS "restaurantId", r.name AS "restaurantName",
                   r.address AS "restaurantAddress", r.region AS "region",
                   m.name AS "name", m.description AS "description", m.price_krw AS "priceKrw",
                   m.cuisine_category AS "cuisineCategory", menu_photo.media_id AS "photoMediaId",
                   m.photo_url AS "photoUrl",
                   m.active AS "active",
                   CASE WHEN :lat IS NULL OR r.latitude IS NULL THEN NULL
                        ELSE """ + DISTANCE_METERS + """
                   END AS "distanceMeters",
                   AVG(rv.overall_score)::double precision AS "overallAverage",
                   AVG(rv.taste_score)::double precision AS "tasteAverage",
                   AVG(rv.value_score)::double precision AS "valueAverage",
                   AVG(rv.portion_score)::double precision AS "portionAverage",
                   COUNT(rv.id) AS "reviewCount"
            FROM menu m
            JOIN restaurant r ON r.id = m.restaurant_id
            LEFT JOIN review rv ON rv.menu_id = m.id
            LEFT JOIN media_asset menu_photo
                   ON menu_photo.media_id = m.photo_media_id AND menu_photo.lifecycle_status = 'ACTIVE'
            """;

    String FILTERS = """
            (:q IS NULL OR lower(m.name) LIKE lower(concat('%', :q, '%'))
                OR lower(r.name) LIKE lower(concat('%', :q, '%'))
                OR lower(coalesce(m.description, '')) LIKE lower(concat('%', :q, '%')))
            AND (:category IS NULL OR m.cuisine_category = :category)
            AND (:region IS NULL OR lower(coalesce(r.region, '')) LIKE lower(concat('%', :region, '%')))
            AND (:radius IS NULL OR (r.latitude IS NOT NULL AND r.longitude IS NOT NULL
                AND """ + DISTANCE_METERS + " <= :radius))\n            ";

    @Query(value = AGGREGATE_SELECT + """
            WHERE m.active = TRUE AND """ + FILTERS + """
            GROUP BY m.id, r.id, r.name, r.address, r.region, menu_photo.media_id, m.photo_url
            ORDER BY
                CASE WHEN :sort = 'overall' THEN AVG(rv.overall_score) END DESC NULLS LAST,
                CASE WHEN :sort = 'taste' THEN AVG(rv.taste_score) END DESC NULLS LAST,
                CASE WHEN :sort = 'value' THEN AVG(rv.value_score) END DESC NULLS LAST,
                CASE WHEN :sort = 'portion' THEN AVG(rv.portion_score) END DESC NULLS LAST,
                CASE WHEN :sort = 'reviewCount' THEN COUNT(rv.id) END DESC NULLS LAST,
                COUNT(rv.id) DESC,
                AVG(rv.overall_score) DESC NULLS LAST,
                m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> search(@Param("q") String q, @Param("category") String category,
                               @Param("region") String region, @Param("lat") Double latitude,
                               @Param("lon") Double longitude, @Param("radius") Integer radiusMeters,
                               @Param("sort") String sort);

    @Query(value = """
            SELECT COUNT(*)
            FROM menu m JOIN restaurant r ON r.id = m.restaurant_id
            WHERE m.active = TRUE AND r.latitude IS NULL AND r.longitude IS NULL
              AND (:q IS NULL OR lower(m.name) LIKE lower(concat('%', :q, '%'))
                  OR lower(r.name) LIKE lower(concat('%', :q, '%'))
                  OR lower(coalesce(m.description, '')) LIKE lower(concat('%', :q, '%')))
              AND (:category IS NULL OR m.cuisine_category = :category)
              AND (:region IS NULL OR lower(coalesce(r.region, '')) LIKE lower(concat('%', :region, '%')))
            """, nativeQuery = true)
    long countUnlocated(@Param("q") String q, @Param("category") String category,
                        @Param("region") String region);

    @Query(value = AGGREGATE_SELECT + """
            WHERE m.id = :menuId AND m.active = TRUE
            GROUP BY m.id, r.id, r.name, r.address, r.region, menu_photo.media_id, m.photo_url
            """, nativeQuery = true)
    Optional<MenuAggregate> findMenuAggregate(@Param("menuId") Long menuId,
                                              @Param("lat") Double latitude,
                                              @Param("lon") Double longitude);

    @Query(value = AGGREGATE_SELECT + """
            WHERE r.id = :restaurantId AND m.active = TRUE
            GROUP BY m.id, r.id, r.name, r.address, r.region, menu_photo.media_id, m.photo_url
            ORDER BY m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> findRestaurantMenus(@Param("restaurantId") Long restaurantId,
                                            @Param("lat") Double latitude,
                                            @Param("lon") Double longitude);

    @Query(value = AGGREGATE_SELECT + """
            WHERE r.id = :restaurantId
            GROUP BY m.id, r.id, r.name, r.address, r.region, menu_photo.media_id, m.photo_url
            ORDER BY m.id ASC
            """, nativeQuery = true)
    List<MenuAggregate> findManageRestaurantMenus(@Param("restaurantId") Long restaurantId,
                                                  @Param("lat") Double latitude,
                                                  @Param("lon") Double longitude);

    @Query(value = """
            SELECT rv.id AS "id", rv.overall_score AS "overallScore",
                   rv.taste_score AS "tasteScore", rv.value_score AS "valueScore",
                   rv.portion_score AS "portionScore", rv.comment AS "comment",
                   rv.created_at AS "createdAt",
            COALESCE((SELECT string_agg(rp.media_id, ',' ORDER BY rp.sort_order, rp.media_id)
                             FROM review_photo rp
                             JOIN media_asset review_photo ON review_photo.media_id = rp.media_id
                             WHERE rp.review_id = rv.id AND review_photo.lifecycle_status = 'ACTIVE'), '')
                       AS "photoMediaIdsCsv"
            FROM review rv WHERE rv.menu_id = :menuId
            ORDER BY rv.created_at DESC, rv.id DESC
            """, nativeQuery = true)
    List<PublicReviewRow> findPublicReviews(@Param("menuId") Long menuId);
}
