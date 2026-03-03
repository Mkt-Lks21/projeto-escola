import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";
import PublicOnlyRoute from "./PublicOnlyRoute";
import { useAuth } from "@/hooks/useAuth";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

describe("Route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users from protected route to /auth", () => {
    mockUseAuth.mockReturnValue({
      session: null,
      user: null,
      isAuthLoading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route path="/auth" element={<div>AUTH PAGE</div>} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <div>CHAT PAGE</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("AUTH PAGE")).toBeInTheDocument();
  });

  it("allows authenticated users in protected route", () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: "token" } as never,
      user: { id: "u-1", email: "user@test.com" } as never,
      isAuthLoading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <div>CHAT PAGE</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("CHAT PAGE")).toBeInTheDocument();
  });

  it("redirects authenticated users from public-only route to next path", () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: "token" } as never,
      user: { id: "u-1", email: "user@test.com" } as never,
      isAuthLoading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/auth?next=%2Fchat"]}>
        <Routes>
          <Route path="/auth" element={<PublicOnlyRoute><div>AUTH PAGE</div></PublicOnlyRoute>} />
          <Route path="/chat" element={<div>CHAT PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("CHAT PAGE")).toBeInTheDocument();
  });

  it("allows anonymous users in public-only route", () => {
    mockUseAuth.mockReturnValue({
      session: null,
      user: null,
      isAuthLoading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <Routes>
          <Route path="/auth" element={<PublicOnlyRoute><div>AUTH PAGE</div></PublicOnlyRoute>} />
          <Route path="/" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("AUTH PAGE")).toBeInTheDocument();
  });
});
