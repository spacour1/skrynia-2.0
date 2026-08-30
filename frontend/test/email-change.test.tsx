import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerifyEmailPage from "@/app/[locale]/verify-email/page";
import { ProfileCard } from "@/app/[locale]/settings/_components/ProfileCard";
import type { ProfileState, SettingsT } from "@/app/[locale]/settings/_components/types";
import { navigationMock } from "./setup";
import { renderWithProviders } from "./helpers/render";

const apiFetchMock = vi.hoisted(() => vi.fn());
const hydrateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock("@/lib/auth-store", () => ({
  useAuth: (selector: (state: { hydrate: typeof hydrateMock }) => unknown) =>
    selector({ hydrate: hydrateMock })
}));

describe("pending email confirmation page", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({});
    hydrateMock.mockReset();
    hydrateMock.mockResolvedValue(undefined);
  });

  it("uses the dedicated single-use email-change confirmation endpoint", async () => {
    window.history.replaceState(
      {},
      "",
      "/en/verify-email?purpose=email-change&token=pending-token"
    );
    const user = userEvent.setup();
    renderWithProviders(<VerifyEmailPage />);

    await user.click(screen.getByRole("button", { name: "Activate new email" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/users/email-change/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "pending-token" })
      });
    });
    expect(
      await screen.findByRole("heading", { name: "Email changed securely" })
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Go to login" }));
    expect(navigationMock.push).toHaveBeenCalledWith("/en/login", undefined);
  });
});

const labels: Record<string, string> = {
  "settings.status.verified": "Verified",
  "settings.status.notVerified": "Not verified",
  "settings.avatar.change": "Change avatar",
  "settings.avatar.delete": "Delete",
  "settings.avatar.hint": "Avatar hint",
  "settings.profile.title": "Profile",
  "settings.profile.editTitle": "Profile details",
  "settings.profile.editText": "Public profile data",
  "settings.profile.nameLabel": "Display name",
  "settings.profile.bio": "Bio",
  "settings.profile.bioPlaceholder": "Bio",
  "settings.profile.save": "Save profile",
  "settings.push.title": "Push notifications",
  "settings.push.text": "Push updates",
  "settings.emailVerify.resend": "Verify email",
  "settings.phone.verifyAction": "Verify phone",
  "auth.emailChange.newEmail": "New email",
  "auth.emailChange.title": "Secure email change",
  "auth.emailChange.text": "Confirm this sensitive action",
  "auth.emailChange.passwordCredential": "Current password for email change",
  "auth.emailChange.twoFactorCredential": "Authenticator or backup code",
  "auth.emailChange.submit": "Send confirmation link",
  "settings.password.current": "Current password"
};

const t = ((key: string, params?: Record<string, unknown>) => {
  if (key === "auth.emailChange.pending") {
    return `Pending ${String(params?.email ?? "")}`;
  }
  return labels[key] ?? key;
}) as SettingsT;

function ProfileHarness({ onRequest }: { onRequest: () => void }) {
  const [profile, setProfile] = useState<ProfileState>({
    displayName: "Test User",
    email: "old@example.test",
    avatarUrl: "",
    profileDescription: "",
    pushEnabled: false
  });
  const [credential, setCredential] = useState("");

  return (
    <ProfileCard
      profile={profile}
      setProfile={setProfile}
      avatarSrc=""
      initial="T"
      role="user"
      currentEmail="old@example.test"
      pendingEmail={null}
      twoFactorEnabled={false}
      emailVerified
      phone=""
      phoneVerified={false}
      profileMessage=""
      emailChangeCredential={credential}
      emailChangeMessage=""
      verifyMessage=""
      uploadPending={false}
      updatePending={false}
      emailChangePending={false}
      resendPending={false}
      onSubmit={(event) => event.preventDefault()}
      onPickAvatar={() => undefined}
      onClearAvatar={() => undefined}
      onEmailChangeCredential={setCredential}
      onRequestEmailChange={onRequest}
      onResendVerification={() => undefined}
      t={t}
    />
  );
}

describe("settings email change", () => {
  it("requires an explicit step-up credential before requesting a new address", async () => {
    const onRequest = vi.fn();
    const user = userEvent.setup();
    render(<ProfileHarness onRequest={onRequest} />);

    const email = screen.getByLabelText("New email");
    await user.clear(email);
    await user.type(email, "new@example.test");
    const submit = screen.getByRole("button", { name: "Send confirmation link" });
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByLabelText("Current password for email change"),
      "current-secret"
    );
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onRequest).toHaveBeenCalledTimes(1);
  });
});
