import type { z } from "zod";

export class EnvironmentValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Некорректная конфигурация окружения: ${issues.join("; ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function requireEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  environment: NodeJS.ProcessEnv = process.env,
): z.output<TSchema> {
  const result = schema.safeParse(environment);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
    return `${path}: ${issue.message}`;
  });

  throw new EnvironmentValidationError(issues);
}

export const parseEnv = requireEnv;
