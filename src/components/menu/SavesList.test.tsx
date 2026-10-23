import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n, { i18nReady } from "../../i18n";
import SavesList from "./SavesList";

// Uses the real i18n instance rather than a mocked `t`, because two of these
// tests are about what i18next itself does with the value: resolving a
// backend-generated key, and escaping player text inside a translation that
// carries its own markup.
beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("en");
});

function save(overrides: Partial<{ id: string; name: string; account_id: string | null }> = {}) {
  return {
    id: "save-1",
    name: "Old Save",
    manager_name: "Jane Doe",
    team_name: "Alpha FC",
    db_filename: "save-1.db",
    checksum: "abc",
    created_at: "2026-08-01T00:00:00Z",
    last_played_at: "2026-08-02T00:00:00Z",
    account_id: "account-1" as string | null,
    ...overrides,
  };
}

function renderList(
  saves: ReturnType<typeof save>[],
  confirmDeleteId: string | null = null,
  handlers: Partial<{
    onLoad: (id: string) => void;
    onClaim: (id: string) => void;
    onConfirmClaim: (id: string | null) => void;
  }> = {},
  confirmClaimId: string | null = null,
) {
  render(
    <SavesList
      saves={saves}
      isLoading={false}
      confirmDeleteId={confirmDeleteId}
      confirmClaimId={confirmClaimId}
      coachName="Dung Ung"
      onLoad={handlers.onLoad ?? vi.fn()}
      onClaim={handlers.onClaim ?? vi.fn()}
      onConfirmClaim={handlers.onConfirmClaim ?? vi.fn()}
      onDelete={vi.fn()}
      onConfirmDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("SavesList", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("resolves a save name the game generated as a translation key", () => {
    renderList([save({ name: "be.save.defaultName?manager=Jane%20Doe" })]);

    expect(screen.getByText("Jane Doe's Career")).toBeInTheDocument();
  });

  it("translates that name into the player's language", async () => {
    await i18n.changeLanguage("fr");
    renderList([save({ name: "be.save.defaultName?manager=Jane%20Doe" })]);

    expect(screen.getByText("Carrière de Jane Doe")).toBeInTheDocument();
  });

  // Saves written before the key existed, and any the player renamed, are
  // plain text and must survive untouched.
  it("shows a plain save name unchanged", () => {
    renderList([save({ name: "My 1997 run" })]);

    expect(screen.getByText("My 1997 run")).toBeInTheDocument();
  });

  // `menu.deleteConfirm` carries its own <strong> markup, rendered as an
  // element by Trans. The save name inside it is player text.
  it("escapes markup in a save name instead of rendering it", () => {
    const { container } = render(
      <SavesList
        saves={[save({ name: '<img src=x onerror="alert(1)">' })]}
        isLoading={false}
        confirmDeleteId="save-1"
        confirmClaimId={null}
        coachName="Dung Ung"
        onLoad={vi.fn()}
        onClaim={vi.fn()}
        onConfirmClaim={vi.fn()}
        onDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    // The <strong> the translation itself provides must still be real markup.
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  // Given a save named with markup the translation itself uses (<strong>),
  // when its deletion is confirmed,
  // then the name stays text: only the translation's own <strong> is an element.
  it("does not let a save name add markup", () => {
    const { container } = render(
      <SavesList
        saves={[save({ name: "<strong>Mine</strong>" })]}
        isLoading={false}
        confirmDeleteId="save-1"
        confirmClaimId={null}
        coachName="Dung Ung"
        onLoad={vi.fn()}
        onClaim={vi.fn()}
        onConfirmClaim={vi.fn()}
        onDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("strong")).toHaveLength(1);
    expect(container.textContent).toContain("<strong>Mine</strong>");
  });

  // Given a career of the logged-in coach, when it is picked, then it loads straight away.
  it("loads a career of the coach without asking", () => {
    const onLoad = vi.fn();
    const onConfirmClaim = vi.fn();
    renderList([save()], null, { onLoad, onConfirmClaim });

    fireEvent.click(screen.getByText("Old Save"));

    expect(onLoad).toHaveBeenCalledWith("save-1");
    expect(onConfirmClaim).not.toHaveBeenCalled();
  });

  // Given a career from before accounts, when it is picked, then the player is asked to attach it first.
  it("asks before attaching a career without an account", () => {
    const onLoad = vi.fn();
    const onConfirmClaim = vi.fn();
    renderList([save({ account_id: null })], null, { onLoad, onConfirmClaim });

    expect(screen.getByText("No account")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Old Save"));

    expect(onConfirmClaim).toHaveBeenCalledWith("save-1");
    expect(onLoad).not.toHaveBeenCalled();
  });

  // Given the attach question on screen, when the player agrees, then the career is claimed.
  it("claims the career when the player agrees", () => {
    const onClaim = vi.fn();
    renderList([save({ account_id: null })], null, { onClaim }, "save-1");

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Attach it to Dung Ung?");
    fireEvent.click(screen.getByRole("button", { name: "Attach and load" }));

    expect(onClaim).toHaveBeenCalledWith("save-1");
  });
});
