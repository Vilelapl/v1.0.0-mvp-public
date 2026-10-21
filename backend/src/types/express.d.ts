export {};

declare global {
  namespace Express {
    interface AuthenticatedWebIdentity {
      userId: string;
      email: string;
      sessionId: string;
    }

    interface Request {
      requestId: string;
      webAuth?: AuthenticatedWebIdentity;
      deviceAuth?: AuthenticatedDeviceIdentity;
    }

    interface AuthenticatedDeviceIdentity {
      userId: string;
      deviceId: string;
    }
  }
}
