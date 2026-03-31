export async function withRetry<T>(operation: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  throw lastError;
}
