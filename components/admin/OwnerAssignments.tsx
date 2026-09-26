"use client";

import { useMemo, useState } from "react";
import styles from "@/components/auth/auth.module.css";

export type AdminUser = { id: string; displayName: string };
export type AdminRestaurant = { id: string; name: string };
export type OwnerAssignment = { userId: string; restaurantId: string };

type SetOwnerAction = (
  userId: string,
  restaurantId: string,
  isOwner: boolean,
) => Promise<{ ok: boolean; message: string }>;

export function OwnerAssignments({
  users,
  restaurants,
  assignments,
  setOwner,
}: {
  users: AdminUser[];
  restaurants: AdminRestaurant[];
  assignments: OwnerAssignment[];
  setOwner: SetOwnerAction;
}) {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [message, setMessage] = useState("");
  const [pendingKey, setPendingKey] = useState("");

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const restaurantsById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])),
    [restaurants],
  );
  const query = search.trim().toLocaleLowerCase();
  const filteredUsers = users.filter((user) =>
    !query ||
    user.displayName.toLocaleLowerCase().includes(query) ||
    user.id.toLocaleLowerCase().includes(query),
  );
  const filteredAssignments = assignments.filter((assignment) => {
    const user = usersById.get(assignment.userId);
    const restaurant = restaurantsById.get(assignment.restaurantId);
    return !query || [user?.displayName, user?.id, restaurant?.name, restaurant?.id]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query));
  });

  async function changeOwner(userId: string, restaurantId: string, isOwner: boolean) {
    const key = `${userId}:${restaurantId}`;
    setPendingKey(key);
    setMessage("");
    try {
      const result = await setOwner(userId, restaurantId, isOwner);
      setMessage(result.message);
    } catch {
      setMessage("요청을 처리하지 못했어요. 권한을 확인하고 다시 시도해 주세요.");
    } finally {
      setPendingKey("");
    }
  }

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>가게 운영자 관리</h1>
      <p className={styles.description}>
        사용자를 찾아 가게 운영 권한을 연결하거나 해제할 수 있어요. 이메일 주소는 표시하지 않습니다.
      </p>

      <label className={styles.field}>
        사용자 또는 가게 검색
        <input
          className={styles.input}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="이름, 사용자 ID, 가게 이름"
        />
      </label>

      <h2 className={styles.sectionTitle}>운영자 연결</h2>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          사용자
          <select
            className={styles.select}
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
          >
            <option value="">사용자 선택</option>
            {filteredUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName} · {user.id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          가게
          <select
            className={styles.select}
            value={selectedRestaurant}
            onChange={(event) => setSelectedRestaurant(event.target.value)}
          >
            <option value="">가게 선택</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </select>
        </label>
        <span />
        <button
          className={styles.button}
          type="button"
          disabled={!selectedUser || !selectedRestaurant || Boolean(pendingKey)}
          onClick={() => void changeOwner(selectedUser, selectedRestaurant, true)}
        >
          운영자 연결
        </button>
      </div>

      {message ? <p className={styles.message} role="status">{message}</p> : null}

      <h2 className={styles.sectionTitle}>현재 연결</h2>
      {filteredAssignments.length ? (
        <ul className={styles.assignmentList}>
          {filteredAssignments.map((assignment) => {
            const user = usersById.get(assignment.userId);
            const restaurant = restaurantsById.get(assignment.restaurantId);
            const key = `${assignment.userId}:${assignment.restaurantId}`;
            return (
              <li className={styles.assignmentRow} key={key}>
                <span className={styles.assignmentMeta}>
                  <strong>{restaurant?.name ?? "이름 없는 가게"}</strong>
                  <span>{user?.displayName ?? "이름 없는 사용자"}</span>
                  <small>{user?.id ?? assignment.userId}</small>
                </span>
                <button
                  className={`${styles.secondaryButton} ${styles.dangerButton}`}
                  type="button"
                  disabled={Boolean(pendingKey)}
                  onClick={() => void changeOwner(assignment.userId, assignment.restaurantId, false)}
                >
                  {pendingKey === key ? "처리 중…" : "연결 해제"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.description}>검색 조건에 맞는 연결이 없습니다.</p>
      )}
    </div>
  );
}
