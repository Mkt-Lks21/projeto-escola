import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import Auth from "./Auth";
import { useAuth } from "@/hooks/useAuth";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

describe("Auth page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits sign in form", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const signUp = vi.fn();
    const signOut = vi.fn();

    mockUseAuth.mockReturnValue({
      session: null,
      user: null,
      isAuthLoading: false,
      signIn,
      signUp,
      signOut,
    });

    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@test.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "123456" } });

    const submitButton = screen
      .getAllByRole("button", { name: "Entrar" })
      .find((button) => button.getAttribute("type") === "submit");

    expect(submitButton).toBeTruthy();
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("user@test.com", "123456");
    });
  });

  it("submits sign up form", async () => {
    const signIn = vi.fn();
    const signUp = vi.fn().mockResolvedValue({ requiresEmailConfirmation: true });
    const signOut = vi.fn();

    mockUseAuth.mockReturnValue({
      session: null,
      user: null,
      isAuthLoading: false,
      signIn,
      signUp,
      signOut,
    });

    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
        </Routes>
      </MemoryRouter>,
    );

    const signUpTab = screen.getByRole("tab", { name: "Criar conta" });
    fireEvent.pointerDown(signUpTab);
    fireEvent.mouseDown(signUpTab);
    fireEvent.click(signUpTab);

    await screen.findByLabelText("Confirmar senha");

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@test.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "123456" } });

    const submitButton = screen
      .getAllByRole("button", { name: "Criar conta" })
      .find((button) => button.getAttribute("type") === "submit");

    expect(submitButton).toBeTruthy();
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith("new@test.com", "123456");
    });
  });
});
