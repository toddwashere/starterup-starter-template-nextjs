export function getPathForHome() {
  return "/";
}

export function getPathForSignIn() {
  return "/sign-in";
}

export function getPathForSignUp() {
  return "/sign-up";
}

export function getPathForForgotPassword() {
  return "/forgot-password";
}

export function getPathForResetPassword() {
  return "/reset-password";
}

export function getPathForVerifyEmail() {
  return "/verify-email";
}

export function getPathForStatus() {
  return "/status";
}

export function getPathForCreateOrg() {
  return "/create-org";
}

export function getPathForOrg(orgSlug: string) {
  return `/${orgSlug}`;
}

export function getPathForOrgSettings(orgSlug: string) {
  return `/${orgSlug}/settings`;
}

export function getPathForOrgSettingsGeneral(orgSlug: string) {
  return `/${orgSlug}/settings/general`;
}

export function getPathForOrgMembers(orgSlug: string) {
  return `/${orgSlug}/settings/members`;
}

export function getPathForOrgSettingsMcp(orgSlug: string) {
  return `/${orgSlug}/settings/mcp`;
}

export function getPathForOrgSettingsMcpTest(orgSlug: string) {
  return `/${orgSlug}/settings/api-keys/mcp-test`;
}

export function getPathForAcceptInvitation(invitationId: string) {
  return `/accept-invitation/${invitationId}`;
}

export function getPathForAccountSettings() {
  return "/account";
}

export function getPathForConsent() {
  return "/consent";
}

export function getPathForOrgCampaigns(orgSlug: string) {
  return `/${orgSlug}/campaigns`;
}

export function getPathForOrgCampaign(orgSlug: string, campaignId: string) {
  return `/${orgSlug}/campaigns/${campaignId}`;
}

export function getPathForOrgCampaignStep(
  orgSlug: string,
  campaignId: string,
  stepId: string,
) {
  return `/${orgSlug}/campaigns/${campaignId}/steps/${stepId}`;
}

export function getPathForOrgFollowUps(orgSlug: string) {
  return `/${orgSlug}/campaigns/follow-ups`;
}

export function getPathForOrgFollowUp(orgSlug: string, followUpId: string) {
  return `/${orgSlug}/campaigns/follow-ups/${followUpId}`;
}

export function getPathForOrgFollowUpStep(
  orgSlug: string,
  followUpId: string,
  stepId: string,
) {
  return `/${orgSlug}/campaigns/follow-ups/${followUpId}/steps/${stepId}`;
}
