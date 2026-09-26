"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuEditorRow } from "@/lib/data/catalog";
import { ImageUpload } from "@/components/media/ImageUpload";
import styles from "@/components/auth/auth.module.css";

export type MenuSaveInput = {
  id: string | null;
  name: string;
  description: string;
  priceKrw: number | null;
  cuisineCategory: string;
  active: boolean;
};

export type MenuSaveResult = { ok: boolean; message: string; menuId?: number };
type MenuSaveAction = (input: MenuSaveInput) => Promise<MenuSaveResult>;

type MenuEditorProps = {
  restaurantName: string;
  menus: MenuEditorRow[];
  saveMenu: MenuSaveAction;
};

const CATEGORIES = [
  ["KOREAN", "한식"],
  ["WESTERN", "양식"],
  ["CHINESE", "중식"],
  ["JAPANESE", "일식"],
  ["SNACK", "분식"],
  ["PUB", "주점"],
  ["CAFE", "카페·디저트"],
  ["OTHER", "기타"],
] as const;

export function MenuEditor({ restaurantName, menus, saveMenu }: MenuEditorProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [active, setActive] = useState(true);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pending, setPending] = useState(false);

  function clearForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setPrice("");
    setCategory("OTHER");
    setActive(true);
  }

  function editMenu(menu: MenuEditorRow) {
    setEditingId(menu.id);
    setName(menu.name);
    setDescription(menu.description);
    setPrice(menu.priceKrw === null ? "" : String(menu.priceKrw));
    setCategory(menu.cuisineCategory);
    setActive(menu.active);
    setMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    const parsedPrice = price.trim() ? Number(price) : null;
    if (!trimmedName || trimmedName.length > 160) {
      setMessage("메뉴 이름을 1자 이상 160자 이하로 입력해 주세요.");
      setMessageIsError(true);
      return;
    }
    if (trimmedDescription.length > 1000) {
      setMessage("메뉴 설명은 1,000자 이하로 입력해 주세요.");
      setMessageIsError(true);
      return;
    }
    if (parsedPrice !== null && (!Number.isSafeInteger(parsedPrice) || parsedPrice < 0 || parsedPrice > 100_000_000)) {
      setMessage("가격은 0원 이상 100,000,000원 이하의 정수로 입력해 주세요.");
      setMessageIsError(true);
      return;
    }
    if (!CATEGORIES.some(([value]) => value === category)) {
      setMessage("음식 종류를 다시 선택해 주세요.");
      setMessageIsError(true);
      return;
    }

    setPending(true);
    setMessage("");
    try {
      const result = await saveMenu({
        id: editingId,
        name: trimmedName,
        description: trimmedDescription,
        priceKrw: parsedPrice,
        cuisineCategory: category,
        active,
      });
      setMessage(result.message);
      setMessageIsError(!result.ok);
      if (result.ok) {
        if (result.menuId && Number.isSafeInteger(result.menuId) && result.menuId > 0) {
          setEditingId(String(result.menuId));
        } else {
          clearForm();
        }
        router.refresh();
      }
    } catch {
      setMessage("메뉴를 저장하지 못했어요. 권한과 입력값을 확인해 주세요.");
      setMessageIsError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="menu-editor-title">
      <h2 id="menu-editor-title" className={styles.title}>메뉴 관리</h2>
      <p className={styles.description}>
        {restaurantName}의 메뉴를 등록하고 수정할 수 있어요. 메뉴를 삭제하는 대신 비공개로 전환하면 기존 리뷰 기록이 보존돼요.
      </p>

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          메뉴 이름
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required />
        </label>
        <label className={styles.field}>
          메뉴 설명 <span aria-hidden="true">(선택)</span>
          <textarea className={styles.input} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} />
        </label>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            가격(원) <span aria-hidden="true">(선택)</span>
            <input className={styles.input} type="number" min="0" max="100000000" step="1" value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" />
          </label>
          <label className={styles.field}>
            음식 종류
            <select className={styles.select} value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span>공개 상태</span>
          <select className={styles.select} value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}>
            <option value="active">공개</option>
            <option value="inactive">비공개로 보관</option>
          </select>
        </label>
        <div className={styles.toolbar}>
          <button className={styles.button} type="submit" disabled={pending}>
            {pending ? "저장 중…" : editingId ? "변경 사항 저장" : "메뉴 등록"}
          </button>
          {editingId ? (
            <button className={styles.secondaryButton} type="button" disabled={pending} onClick={clearForm}>
              새 메뉴 등록
            </button>
          ) : <span />}
        </div>
        {editingId ? (
          <ImageUpload kind="MENU" menuId={Number(editingId)} disabled={pending} />
        ) : (
          <p className={styles.description}>
            메뉴를 먼저 등록하면 사진을 추가할 수 있어요. 등록 후 메뉴 목록에서 <strong>수정</strong>을 눌러 사진을 관리해 주세요.
          </p>
        )}
        {message ? <p className={styles.message} role={messageIsError ? "alert" : "status"}>{message}</p> : null}
      </form>

      <h3 className={styles.sectionTitle}>등록된 메뉴</h3>
      {menus.length ? (
        <ul className={styles.assignmentList}>
          {menus.map((menu) => (
            <li className={styles.assignmentRow} key={menu.id}>
              <span className={styles.assignmentMeta}>
                <strong>{menu.name}</strong>
                <span>{menu.priceKrw === null ? "가격 미등록" : menu.priceKrw.toLocaleString("ko-KR") + "원"}</span>
                <small>{menu.active ? "공개 중" : "비공개"}</small>
              </span>
              <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => editMenu(menu)}>
                수정
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.description}>등록된 메뉴가 없습니다.</p>
      )}
    </section>
  );
}
