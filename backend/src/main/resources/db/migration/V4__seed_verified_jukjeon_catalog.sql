-- Small, manually verified Jukjeon starter catalog.
-- Sources and field-level provenance are recorded in docs/jukjeon-catalog-sources.md.
-- Images, coordinates, and unsupported menu descriptions are intentionally omitted.

INSERT INTO restaurant (name, description, address, region)
VALUES
    (
        '크리에이티브커피 단국대점',
        '단국대학교 죽전캠퍼스 앞',
        '경기도 용인시 수지구 죽전로144번길 15-9 (죽전동)',
        '용인시 수지구'
    )
ON CONFLICT (name) DO NOTHING;

INSERT INTO menu (restaurant_id, name, description, price_krw, cuisine_category)
SELECT r.id, seed.name, seed.description, seed.price_krw, seed.cuisine_category
FROM (
    VALUES
        ('크리에이티브커피 단국대점', '아메리카노', NULL::VARCHAR(1000), 3500, 'CAFE'),
        ('크리에이티브커피 단국대점', '아이스블럭라떼', NULL::VARCHAR(1000), 5500, 'CAFE'),
        ('크리에이티브커피 단국대점', '카페라떼', NULL::VARCHAR(1000), 4500, 'CAFE'),
        ('크리에이티브커피 단국대점', '바닐라라떼', NULL::VARCHAR(1000), 5000, 'CAFE'),
        ('크리에이티브커피 단국대점', '버터쫀득바', NULL::VARCHAR(1000), 3000, 'CAFE'),
        ('크리에이티브커피 단국대점', '크랜베리 스콘', NULL::VARCHAR(1000), 4500, 'CAFE')
) AS seed(restaurant_name, name, description, price_krw, cuisine_category)
JOIN restaurant r
  ON r.name = seed.restaurant_name
 AND r.address = '경기도 용인시 수지구 죽전로144번길 15-9 (죽전동)'
ON CONFLICT (restaurant_id, name) DO NOTHING;
