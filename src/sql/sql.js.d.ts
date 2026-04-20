/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Type declarations for sql.js module
 * These extend the @types/sql.js definitions to ensure proper module resolution
 */
declare module "sql.js" {
  type SqlValue = number | string | Uint8Array | null;
  type ParamsObject = Record<string, SqlValue>;
  type BindParams = SqlValue[] | ParamsObject | null;

  interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: BindParams): Database;
    exec(sql: string, params?: BindParams): QueryExecResult[];
    prepare(sql: string): Statement;
    close(): void;
  }

  export class Statement {
    bind(params?: BindParams): boolean;
    step(): boolean;
    get(params?: BindParams): SqlValue[];
    getColumnNames(): string[];
    run(params?: BindParams): void;
    free(): boolean;
    reset(): void;
  }

  interface InitSqlJsStatic {
    (config?: Record<string, unknown>): Promise<SqlJsStatic>;
    default?: InitSqlJsStatic;
  }

  const initSqlJs: InitSqlJsStatic;
  export default initSqlJs;
}
