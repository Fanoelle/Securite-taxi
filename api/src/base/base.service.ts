import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { existsSync } from 'fs';

/**
 * Emplacements usuels de la socket Unix de PostgreSQL : Debian/Ubuntu
 * d'abord, puis le defaut amont utilise par Red Hat et macOS.
 */
const REPERTOIRE_SOCKET =
  ['/var/run/postgresql', '/tmp'].find((chemin) =>
    existsSync(chemin + '/.s.PGSQL.5432'),
  ) ?? '/var/run/postgresql';

/**
 * Parametres de connexion, deduits de l'environnement. Exportes pour que
 * les scripts d'exploitation se connectent exactement comme l'API.
 */
export function configurationConnexion() {
  return {
    host: process.env.PGHOST?.trim() || REPERTOIRE_SOCKET,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'securitaxi',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD?.trim() || undefined,
  };
}

/**
 * Accès PostgreSQL. Requêtes paramétrées uniquement — jamais de
 * concaténation de chaînes dans du SQL.
 */
@Injectable()
export class BaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(BaseService.name);

  constructor() {
    this.pool = new Pool({
      ...configurationConnexion(),
      max: 20,
      idleTimeoutMillis: 30_000,
    });

    this.pool.on('error', (err) =>
      this.logger.error(`Erreur du pool PostgreSQL : ${err.message}`),
    );
  }

  async requete<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    parametres: unknown[] = [],
  ): Promise<T[]> {
    const debut = Date.now();
    const resultat = await this.pool.query<T>(sql, parametres);
    const duree = Date.now() - debut;
    if (duree > 200) {
      this.logger.warn(`Requête lente (${duree} ms) : ${sql.slice(0, 90)}`);
    }
    return resultat.rows;
  }

  /** Première ligne, ou null. */
  async premier<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    parametres: unknown[] = [],
  ): Promise<T | null> {
    const lignes = await this.requete<T>(sql, parametres);
    return lignes[0] ?? null;
  }

  /**
   * Exécute un ensemble d'opérations dans une transaction.
   * Tout échec annule l'ensemble — indispensable pour la validation d'un
   * dossier, qui change un statut ET émet un QR : jamais l'un sans l'autre.
   */
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resultat = await operation(client);
      await client.query('COMMIT');
      return resultat;
    } catch (erreur) {
      await client.query('ROLLBACK');
      throw erreur;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
