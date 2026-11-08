import { rateLimit } from "express-rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function createRateLimiter(limit: number, windowMs = FIFTEEN_MINUTES_MS) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Muitas solicitações. Tente novamente em alguns minutos.",
      code: "RATE_LIMITED",
    },
  });
}

export const apiRateLimiter = createRateLimiter(1_200);

export const registerRateLimiter = createRateLimiter(5);
export const loginRateLimiter = createRateLimiter(10);
export const googleOAuthRateLimiter = createRateLimiter(20);
export const changePasswordRateLimiter = createRateLimiter(5);

export const revealRateLimiter = createRateLimiter(60);
export const createOrderRateLimiter = createRateLimiter(10);
export const simulatePaymentRateLimiter = createRateLimiter(10);
export const redemptionRateLimiter = createRateLimiter(5);
export const cancelRedemptionRateLimiter = createRateLimiter(15);
export const adminRedemptionUpdateRateLimiter = createRateLimiter(30);
