-- Fictional demo catalog for local development. These are not real businesses.
INSERT INTO restaurant (name, description, address) VALUES
    ('가상식당 온기', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '서울 가상구 상상로 1'),
    ('상상분식 연구소', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '서울 가상구 이야기길 25'),
    ('달빛면관', '메뉴 리뷰 화면을 위한 창작 예시 식당입니다.', '부산 가상구 꿈바다로 7');

INSERT INTO menu (restaurant_id, name, description, price_krw)
SELECT r.id, m.name, m.description, m.price_krw
FROM (VALUES
    ('가상식당 온기', '구름버섯 덮밥', '가상의 구름버섯과 들깨 소스를 올린 덮밥입니다.', 11500),
    ('가상식당 온기', '노을 된장국수', '노을빛 토마토 된장 육수로 만든 창작 국수입니다.', 9800),
    ('상상분식 연구소', '별가루 떡볶이', '별 모양 쌀떡과 보랏빛 소스를 담은 창작 메뉴입니다.', 7500),
    ('상상분식 연구소', '바삭구름 김말이', '구름 모양으로 빚은 가상의 김말이입니다.', 4200),
    ('달빛면관', '초승달 들깨칼국수', '달 모양 만두를 곁들인 창작 들깨칼국수입니다.', 10500),
    ('달빛면관', '푸른파도 비빔면', '푸른색 허브 소스를 사용한 상상 속 비빔면입니다.', 9200)
) AS m(restaurant_name, name, description, price_krw)
JOIN restaurant r ON r.name = m.restaurant_name;
