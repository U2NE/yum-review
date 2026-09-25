-- Product expansion schema and removal of the exact fictional V2 demo catalog.
-- Keep this migration atomic: the fixture validation block must complete before
-- any DELETE is issued, and any mismatch aborts the Flyway transaction.

ALTER TABLE app_user
    ADD COLUMN system_role VARCHAR(24) NOT NULL DEFAULT 'MEMBER',
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT ck_app_user_system_role
        CHECK (system_role IN ('MEMBER', 'SERVER_ADMIN'));

CREATE TABLE restaurant_owner (
    user_id BIGINT NOT NULL,
    restaurant_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_restaurant_owner PRIMARY KEY (user_id, restaurant_id),
    CONSTRAINT fk_restaurant_owner_user FOREIGN KEY (user_id)
        REFERENCES app_user (id) ON DELETE CASCADE,
    CONSTRAINT fk_restaurant_owner_restaurant FOREIGN KEY (restaurant_id)
        REFERENCES restaurant (id) ON DELETE CASCADE
);
CREATE INDEX idx_restaurant_owner_restaurant_id ON restaurant_owner (restaurant_id);

ALTER TABLE restaurant
    ADD COLUMN region VARCHAR(120),
    ADD COLUMN latitude NUMERIC(9, 6),
    ADD COLUMN longitude NUMERIC(9, 6),
    ADD CONSTRAINT ck_restaurant_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90.000000 AND 90.000000),
    ADD CONSTRAINT ck_restaurant_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180.000000 AND 180.000000),
    ADD CONSTRAINT ck_restaurant_coordinates_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE menu
    ADD COLUMN cuisine_category VARCHAR(24) NOT NULL DEFAULT 'OTHER',
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN photo_media_id VARCHAR(64),
    ADD CONSTRAINT ck_menu_cuisine_category
        CHECK (cuisine_category IN ('KOREAN', 'WESTERN', 'CHINESE', 'JAPANESE', 'SNACK', 'PUB', 'CAFE', 'OTHER'));

ALTER TABLE review
    DROP CONSTRAINT ck_review_overall_score,
    DROP CONSTRAINT ck_review_taste_score,
    DROP CONSTRAINT ck_review_value_score,
    DROP CONSTRAINT ck_review_portion_score,
    ALTER COLUMN overall_score TYPE NUMERIC(2, 1) USING overall_score::NUMERIC(2, 1),
    ALTER COLUMN taste_score TYPE NUMERIC(2, 1) USING taste_score::NUMERIC(2, 1),
    ALTER COLUMN value_score TYPE NUMERIC(2, 1) USING value_score::NUMERIC(2, 1),
    ALTER COLUMN portion_score TYPE NUMERIC(2, 1) USING portion_score::NUMERIC(2, 1),
    ADD COLUMN non_event_review_consent BOOLEAN,
    ADD CONSTRAINT ck_review_overall_score
        CHECK (overall_score BETWEEN 0.5 AND 5.0 AND overall_score * 2 = trunc(overall_score * 2)),
    ADD CONSTRAINT ck_review_taste_score
        CHECK (taste_score BETWEEN 0.5 AND 5.0 AND taste_score * 2 = trunc(taste_score * 2)),
    ADD CONSTRAINT ck_review_value_score
        CHECK (value_score BETWEEN 0.5 AND 5.0 AND value_score * 2 = trunc(value_score * 2)),
    ADD CONSTRAINT ck_review_portion_score
        CHECK (portion_score BETWEEN 0.5 AND 5.0 AND portion_score * 2 = trunc(portion_score * 2));

CREATE TABLE media_asset (
    media_id VARCHAR(64) PRIMARY KEY,
    storage_key VARCHAR(255) NOT NULL UNIQUE,
    uploaded_by_user_id BIGINT NOT NULL,
    content_type VARCHAR(120) NOT NULL,
    original_bytes BIGINT NOT NULL,
    stored_bytes BIGINT NOT NULL,
    sha256_hex VARCHAR(64) NOT NULL,
    provenance VARCHAR(24) NOT NULL,
    rights_basis VARCHAR(500) NOT NULL,
    rights_attested_at TIMESTAMPTZ NOT NULL,
    rights_attested_by_user_id BIGINT NOT NULL,
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_media_asset_uploader FOREIGN KEY (uploaded_by_user_id)
        REFERENCES app_user (id),
    CONSTRAINT fk_media_asset_rights_attestor FOREIGN KEY (rights_attested_by_user_id)
        REFERENCES app_user (id),
    CONSTRAINT ck_media_asset_original_bytes
        CHECK (original_bytes > 0 AND original_bytes < 100000000),
    CONSTRAINT ck_media_asset_stored_bytes
        CHECK (stored_bytes > 0),
    CONSTRAINT ck_media_asset_sha256
        CHECK (sha256_hex ~ '^[0-9a-fA-F]{64}$'),
    CONSTRAINT ck_media_asset_provenance
        CHECK (provenance IN ('OWNER_UPLOAD', 'ADMIN_UPLOAD', 'USER_UPLOAD', 'LICENSED')),
    CONSTRAINT ck_media_asset_lifecycle_status
        CHECK (lifecycle_status IN ('ACTIVE', 'REVOKED', 'DELETE_PENDING'))
);
CREATE INDEX idx_media_asset_status_created ON media_asset (lifecycle_status, created_at);

ALTER TABLE menu
    ADD CONSTRAINT fk_menu_photo_media FOREIGN KEY (photo_media_id)
        REFERENCES media_asset (media_id),
    ADD CONSTRAINT uq_menu_photo_media UNIQUE (photo_media_id);

CREATE TABLE review_photo (
    review_id BIGINT NOT NULL,
    media_id VARCHAR(64) NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_review_photo PRIMARY KEY (review_id, media_id),
    CONSTRAINT uq_review_photo_media UNIQUE (media_id),
    CONSTRAINT fk_review_photo_review FOREIGN KEY (review_id)
        REFERENCES review (id) ON DELETE CASCADE,
    CONSTRAINT fk_review_photo_media FOREIGN KEY (media_id)
        REFERENCES media_asset (media_id),
    CONSTRAINT ck_review_photo_sort_order CHECK (sort_order >= 0)
);

-- The V2 catalog is synthetic. Confirm every expected row and the complete
-- menu set before deleting anything, then fail closed on any non-QA review.
DO $fixture_guard$
DECLARE
    expected_restaurant_count INTEGER;
    exact_restaurant_count INTEGER;
    expected_menu_count INTEGER;
    actual_fixture_menu_count INTEGER;
BEGIN
    WITH expected(name, description, address) AS (
        VALUES
            ('가상식당 온기', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '서울 가상구 상상로 1'),
            ('상상분식 연구소', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '서울 가상구 이야기길 25'),
            ('달빛면관', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '부산 가상구 꿈바다로 7')
    )
    SELECT COUNT(*) INTO expected_restaurant_count
    FROM expected e
    JOIN restaurant r ON r.name = e.name
                     AND r.description = e.description
                     AND r.address = e.address;

    SELECT COUNT(*) INTO exact_restaurant_count
    FROM restaurant
    WHERE name IN ('가상식당 온기', '상상분식 연구소', '달빛면관');

    IF expected_restaurant_count <> 3 OR exact_restaurant_count <> 3 THEN
        RAISE EXCEPTION 'V3 fixture cleanup aborted: expected exact V2 restaurant rows (3), found exact %, named %',
            expected_restaurant_count, exact_restaurant_count;
    END IF;

    -- Detect extra or altered restaurants carrying the exact V2 fixture marker.
    IF (SELECT COUNT(*) FROM restaurant
        WHERE description = '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.') <> 3 THEN
        RAISE EXCEPTION 'V3 fixture cleanup aborted: unexpected restaurant carries the V2 fixture marker';
    END IF;

    WITH expected(restaurant_name, menu_name, description, price_krw) AS (
        VALUES
            ('가상식당 온기', '구름버섯 덮밥', '가상의 구름버섯과 들깨 소스를 올린 덮밥입니다.', 11500),
            ('가상식당 온기', '노을 된장국수', '노을빛 토마토 된장 육수로 만든 창작 국수입니다.', 9800),
            ('상상분식 연구소', '별가루 떡볶이', '별 모양 쌀떡과 보랏빛 소스를 담은 창작 메뉴입니다.', 7500),
            ('상상분식 연구소', '바삭구름 김말이', '구름 모양으로 빚은 가상의 김말이입니다.', 4200),
            ('달빛면관', '초승달 들깨칼국수', '달 모양 만두를 곁들인 창작 들깨칼국수입니다.', 10500),
            ('달빛면관', '푸른파도 비빔면', '푸른색 허브 소스를 사용한 상상 속 비빔면입니다.', 9200)
    )
    SELECT COUNT(*) INTO expected_menu_count
    FROM expected e
    JOIN restaurant r ON r.name = e.restaurant_name
    JOIN menu m ON m.restaurant_id = r.id
                 AND m.name = e.menu_name
                 AND m.description = e.description
                 AND m.price_krw = e.price_krw;

    SELECT COUNT(*) INTO actual_fixture_menu_count
    FROM menu m
    JOIN restaurant r ON r.id = m.restaurant_id
    WHERE r.name IN ('가상식당 온기', '상상분식 연구소', '달빛면관');

    IF expected_menu_count <> 6 OR actual_fixture_menu_count <> 6 THEN
        RAISE EXCEPTION 'V3 fixture cleanup aborted: expected exact V2 menu rows (6), found exact %, attached %',
            expected_menu_count, actual_fixture_menu_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM review rv
        JOIN menu m ON m.id = rv.menu_id
        JOIN restaurant r ON r.id = m.restaurant_id
        JOIN app_user u ON u.id = rv.user_id
        WHERE r.name IN ('가상식당 온기', '상상분식 연구소', '달빛면관')
          AND u.email_normalized NOT IN ('qa-ui-20260925@example.invalid')
    ) THEN
        RAISE EXCEPTION 'V3 fixture cleanup aborted: a fixture menu has a review by a non-allowlisted account';
    END IF;

    DELETE FROM review rv
    USING menu m, restaurant r, app_user u
    WHERE rv.menu_id = m.id
      AND m.restaurant_id = r.id
      AND rv.user_id = u.id
      AND r.name IN ('가상식당 온기', '상상분식 연구소', '달빛면관')
      AND u.email_normalized IN ('qa-ui-20260925@example.invalid');

    DELETE FROM menu m
    USING restaurant r
    WHERE m.restaurant_id = r.id
      AND r.name IN ('가상식당 온기', '상상분식 연구소', '달빛면관');

    DELETE FROM restaurant
    WHERE name IN ('가상식당 온기', '상상분식 연구소', '달빛면관');
END
$fixture_guard$;
