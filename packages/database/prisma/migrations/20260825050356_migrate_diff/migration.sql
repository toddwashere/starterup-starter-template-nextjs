-- AlterTable
ALTER TABLE "oauthAccessToken" ALTER COLUMN "scopes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "oauthClient" ALTER COLUMN "contacts" DROP DEFAULT,
ALTER COLUMN "redirectUris" DROP DEFAULT,
ALTER COLUMN "postLogoutRedirectUris" DROP DEFAULT,
ALTER COLUMN "scopes" DROP DEFAULT,
ALTER COLUMN "grantTypes" DROP DEFAULT,
ALTER COLUMN "responseTypes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "oauthConsent" ALTER COLUMN "scopes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "oauthRefreshToken" ALTER COLUMN "scopes" DROP DEFAULT;
