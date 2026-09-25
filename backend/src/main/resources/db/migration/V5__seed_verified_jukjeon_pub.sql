-- Manually verified Jukjeon pub menu from its public Naver Place menu tab.
-- The listing showed a last-updated date of 2026-01-20 on 2026-09-25.
-- No Naver user-posted photos or NAVER Local Search API results are stored.

INSERT INTO restaurant (name, description, address, region)
VALUES (
    '볶신단국대점',
    '맥주·호프',
    '경기 용인시 수지구 죽전로144번길 15-9 1층 볶신',
    '용인시 수지구'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO menu (restaurant_id, name, description, price_krw, cuisine_category)
SELECT r.id, seed.name, seed.description, seed.price_krw, 'PUB'
FROM (
    VALUES
        ('[세트메뉴] 96삼겹튀김 세트', '삼겹튀김(소)+메뉴선택 1개 - 선택메뉴: 김치냉국수, 마라라면, 치즈마라라면(+500원)', 14900),
        ('[세트메뉴] A + B 세트', NULL::VARCHAR(1000), 17900),
        ('[밥도둑] 명란알곤이찜', NULL::VARCHAR(1000), 11900),
        ('[밥도둑] 돼지찌개', '공기밥과 함께 먹으면 두공기 뚝딱', 9900),
        ('[밥도둑] 콩나물불고기', NULL::VARCHAR(1000), 9900),
        ('[국물요리] 올리브 바지락 어묵탕', NULL::VARCHAR(1000), 9900),
        ('[국물요리] 마라국물떡볶이', NULL::VARCHAR(1000), 9900),
        ('[작은국물요리] 김치냉국수', NULL::VARCHAR(1000), 5900),
        ('[작은국물요리] 마라라면', NULL::VARCHAR(1000), 6500),
        ('[작은국물요리] 치즈마라라면', NULL::VARCHAR(1000), 6900),
        ('[튀김요리] 96삼겹튀김(소)', NULL::VARCHAR(1000), 10000),
        ('[튀김요리] 96삼겹튀김(고기2배)', NULL::VARCHAR(1000), 18900),
        ('[튀김요리] 안심탕수육(소)', NULL::VARCHAR(1000), 8900),
        ('[튀김요리] 안심탕수육(중)', NULL::VARCHAR(1000), 16900),
        ('[튀김요리] 인절미탕수육(소)', NULL::VARCHAR(1000), 8900),
        ('[튀김요리] 인절미탕수육(중)', NULL::VARCHAR(1000), 16900),
        ('[튀김요리] 칠리가지튀김(소)', NULL::VARCHAR(1000), 8900),
        ('[볶음요리] 마라샹궈(소)', NULL::VARCHAR(1000), 9900),
        ('[볶음요리] 마라샹궈(중)', NULL::VARCHAR(1000), 18900),
        ('[볶음요리] 마라부속볶음(소)', NULL::VARCHAR(1000), 6900),
        ('[볶음요리] 마라부속볶음(중)', NULL::VARCHAR(1000), 12900),
        ('[디저트] 파인애플 샤베트', NULL::VARCHAR(1000), 5900),
        ('[디저트] 요구르트 샤베트', NULL::VARCHAR(1000), 5900),
        ('[디저트] 망고 샤베트', NULL::VARCHAR(1000), 5900),
        ('[식사] 계란볶음밥', NULL::VARCHAR(1000), 3900),
        ('[식사] 짬뽕볶음밥', NULL::VARCHAR(1000), 3900)
) AS seed(name, description, price_krw)
JOIN restaurant r
  ON r.name = '볶신단국대점'
 AND r.address = '경기 용인시 수지구 죽전로144번길 15-9 1층 볶신'
ON CONFLICT (restaurant_id, name) DO NOTHING;
