// @vitest-environment-options {"url":"https://chatgpt.com/connector/oauth/test-callback"}
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConsentForm from "@/app/api/bd-dot/consent/ConsentForm";

const { signInWithPassword, getAuthorizationDetails, approveAuthorization } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { signInWithPassword, oauth: { getAuthorizationDetails, approveAuthorization } },
  }),
}));

const redirectUri = "https://chatgpt.com/connector/oauth/test-callback";
const authorizationId = "test-authorization";
const permittedRequest = {
  data: { client: { id: "test-client" }, redirect_uri: redirectUri, scope: "openid email offline_access" },
  error: null,
};

function submit() {
  render(<ConsentForm
    supabaseUrl="https://dev.example.com"
    anonKey="test-public-key"
    clientId="test-client"
    subject="test-subject"
    redirectUri={redirectUri}
    authorizationId={authorizationId}
  />);
  fireEvent.change(screen.getByLabelText("BD 점검 계정 이메일"), { target: { value: "dev@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인하고 읽기 권한 승인" }));
}

describe("BD OAuth consent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState(null, "", redirectUri);
  });

  it("approves the exact ChatGPT request including its email identity scope", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "test-subject" } }, error: null });
    getAuthorizationDetails.mockResolvedValue(permittedRequest);
    approveAuthorization.mockResolvedValue({ data: { redirect_url: `${redirectUri}#approved` }, error: null });
    submit();
    await waitFor(() => expect(approveAuthorization).toHaveBeenCalledWith(authorizationId, { skipBrowserRedirect: true }));
    expect(window.location.href).toBe(`${redirectUri}#approved`);
  });

  it("rejects identity data beyond the disclosed email scope after sign-in", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "test-subject" } }, error: null });
    getAuthorizationDetails.mockResolvedValueOnce({
      ...permittedRequest,
      data: { ...permittedRequest.data, scope: "openid profile email offline_access" },
    }).mockResolvedValueOnce(permittedRequest);
    approveAuthorization.mockResolvedValue({ data: { redirect_url: `${redirectUri}#approved` }, error: null });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("로그인은 완료됐지만 OAuth 요청을 승인하지 못했습니다");
    expect(approveAuthorization).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "로그인하고 읽기 권한 승인" }));
    await waitFor(() => expect(approveAuthorization).toHaveBeenCalledExactlyOnceWith(authorizationId, { skipBrowserRedirect: true }));
    expect(window.location.href).toBe(`${redirectUri}#approved`);
  });

  it("distinguishes a dev sign-in failure from authorization failure", async () => {
    signInWithPassword
      .mockResolvedValueOnce({ error: {} })
      .mockResolvedValueOnce({ data: { user: { id: "test-subject" } }, error: null });
    getAuthorizationDetails.mockResolvedValue(permittedRequest);
    approveAuthorization.mockResolvedValue({ error: {} });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("BD 점검 계정으로 로그인하지 못했습니다");
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "로그인하고 읽기 권한 승인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("로그인은 완료됐지만 OAuth 요청을 승인하지 못했습니다");
    expect(getAuthorizationDetails).toHaveBeenCalledOnce();
  });
});
