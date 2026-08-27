import {
  Injectable, BadRequestException, UnauthorizedException,
  ConflictException, NotFoundException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BaseService } from '../base/base.service';
import { SmsService } from '../sms/sms.service';
import { normaliserTelephone, formaterTelephone } from '../commun/format';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';

export type RoleCompte = 'chauffeur' | 'agent' | 'superadmin';

/** Contenu du JWT. Volontairement minimal : rien de sensible dans un jeton. */
export interface ChargeJeton {
  sub: string;            // compte_id
  role: RoleCompte;
  autoriteId: string | null;
}

/** Durée de vie d'un OTP. Assez court pour limiter la fenêtre d'attaque,
 *  assez long pour un SMS qui met parfois une minute à arriver. */
const DUREE_OTP_MINUTES = 10;

/** Au-delà, le code est brûlé : c'est une tentative de force brute. */
const TENTATIVES_MAX = 5;

/** Un OTP par numéro et par minute. Chaque SMS coûte de l'argent. */
const DELAI_RENVOI_SECONDES = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly base: BaseService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Demande d'un code à usage unique.
   *
   * La réponse est **identique** que le numéro existe ou non : sinon,
   * l'API devient un annuaire permettant de savoir qui est inscrit sur
   * la plateforme. Pour un chauffeur, cette information peut être
   * dangereuse.
   */
  async demanderOtp(saisie: string): Promise<{ message: string; expireDansSecondes: number }> {
    const telephone = this.exigerTelephone(saisie);

    const recent = await this.base.premier<{ cree_le: Date }>(
      `SELECT cree_le FROM code_otp
        WHERE telephone = $1 AND cree_le > now() - ($2 || ' seconds')::interval
        ORDER BY cree_le DESC LIMIT 1`,
      [telephone, DELAI_RENVOI_SECONDES],
    );
    if (recent) {
      throw new BadRequestException(
        `Un code a déjà été envoyé. Patientez ${DELAI_RENVOI_SECONDES} secondes avant d'en demander un autre.`,
      );
    }

    const compte = await this.base.premier<{ id: string; actif: boolean }>(
      'SELECT id, actif FROM compte WHERE telephone = $1',
      [telephone],
    );

    // Numéro inconnu ou compte désactivé : on n'envoie rien, mais on
    // répond comme si tout allait bien.
    if (compte?.actif) {
      const code = String(randomInt(100_000, 1_000_000));
      const hash = await bcrypt.hash(code, 10);

      // Les codes encore valides sont invalidés : un seul code vivant
      // à la fois par numéro.
      await this.base.transaction(async (client) => {
        await client.query(
          `UPDATE code_otp SET consomme_le = now()
            WHERE telephone = $1 AND consomme_le IS NULL AND expire_le > now()`,
          [telephone],
        );
        await client.query(
          `INSERT INTO code_otp (telephone, code_hash, expire_le)
           VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
          [telephone, hash, DUREE_OTP_MINUTES],
        );
      });

      await this.sms.envoyer({
        telephone,
        categorie: 'otp',
        contenu:
          `SecuriTaxi : votre code de connexion est ${code}. ` +
          `Valable ${DUREE_OTP_MINUTES} minutes. Ne le communiquez a personne.`,
      });

      this.logger.log(`OTP émis pour ${formaterTelephone(telephone)}`);
    } else {
      this.logger.warn(`OTP demandé pour un numéro inconnu ou inactif : ${telephone}`);
    }

    return {
      message: `Si ce numéro est enregistré, un code vient d'y être envoyé par SMS.`,
      expireDansSecondes: DUREE_OTP_MINUTES * 60,
    };
  }

  /**
   * Vérification du code et délivrance du jeton.
   *
   * Le compteur de tentatives est incrémenté **avant** la comparaison,
   * et dans la même transaction que la lecture : deux requêtes
   * concurrentes ne peuvent pas se partager le même quota d'essais.
   */
  async verifierOtp(saisie: string, code: string) {
    const telephone = this.exigerTelephone(saisie);

    const compteId = await this.base.transaction(async (client) => {
      const otp = await client.query(
        `SELECT id, code_hash, tentatives FROM code_otp
          WHERE telephone = $1 AND consomme_le IS NULL AND expire_le > now()
          ORDER BY cree_le DESC LIMIT 1
          FOR UPDATE`,
        [telephone],
      );

      if (!otp.rowCount) {
        throw new UnauthorizedException(
          'Code expiré ou inexistant. Demandez un nouveau code.',
        );
      }
      const ligne = otp.rows[0];

      if (ligne.tentatives >= TENTATIVES_MAX) {
        await client.query(
          'UPDATE code_otp SET consomme_le = now() WHERE id = $1', [ligne.id],
        );
        throw new UnauthorizedException(
          'Trop de tentatives. Ce code est annulé, demandez-en un nouveau.',
        );
      }

      await client.query(
        'UPDATE code_otp SET tentatives = tentatives + 1 WHERE id = $1', [ligne.id],
      );

      if (!(await bcrypt.compare(code, ligne.code_hash))) {
        const restantes = TENTATIVES_MAX - ligne.tentatives - 1;
        throw new UnauthorizedException(
          `Code incorrect. ${restantes} tentative${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}.`,
        );
      }

      await client.query(
        'UPDATE code_otp SET consomme_le = now() WHERE id = $1', [ligne.id],
      );

      const compte = await client.query(
        'SELECT id FROM compte WHERE telephone = $1 AND actif', [telephone],
      );
      if (!compte.rowCount) {
        throw new UnauthorizedException('Compte introuvable ou désactivé.');
      }

      // Un code reçu par SMS prouve la détention du numéro.
      await client.query(
        `UPDATE compte SET telephone_verifie = true, derniere_connexion = now(),
                modifie_le = now()
          WHERE id = $1`,
        [compte.rows[0].id],
      );

      return compte.rows[0].id as string;
    });

    return this.delivrerJeton(compteId, 'otp');
  }

  /**
   * Connexion par mot de passe — réservée aux agents et administrateurs,
   * qui travaillent sur poste fixe et ne peuvent pas attendre un SMS à
   * chaque ouverture de session.
   */
  async connexionMotDePasse(saisie: string, motDePasse: string) {
    const telephone = this.exigerTelephone(saisie);

    const compte = await this.base.premier<{
      id: string; mot_de_passe_hash: string | null; role: RoleCompte; actif: boolean;
    }>(
      'SELECT id, mot_de_passe_hash, role, actif FROM compte WHERE telephone = $1',
      [telephone],
    );

    // Message unique quelle que soit la cause : ne pas révéler
    // quels numéros existent.
    const refus = new UnauthorizedException('Numéro ou mot de passe incorrect.');

    if (!compte?.actif || !compte.mot_de_passe_hash) {
      // Comparaison à vide pour égaliser le temps de réponse et ne pas
      // laisser deviner l'existence du compte par sa latence.
      await bcrypt.compare(motDePasse, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw refus;
    }

    if (!(await bcrypt.compare(motDePasse, compte.mot_de_passe_hash))) {
      this.logger.warn(`Mot de passe incorrect pour ${telephone}`);
      throw refus;
    }

    await this.base.requete(
      'UPDATE compte SET derniere_connexion = now() WHERE id = $1', [compte.id],
    );

    return this.delivrerJeton(compte.id, 'mot_de_passe');
  }

  /** Profil du porteur du jeton, tel que renvoyé à l'ouverture de session. */
  async profil(compteId: string) {
    const ligne = await this.base.premier<any>(
      `SELECT c.id, c.telephone, c.role, c.autorite_id, c.telephone_verifie,
              a.nom AS autorite_nom,
              ch.id AS chauffeur_id, ch.nom, ch.prenom, ch.statut,
              ch.reference_licence, ch.photo_chemin
         FROM compte c
         LEFT JOIN autorite a ON a.id = c.autorite_id
         LEFT JOIN chauffeur ch ON ch.compte_id = c.id AND ch.supprime_le IS NULL
        WHERE c.id = $1 AND c.actif`,
      [compteId],
    );

    if (!ligne) throw new NotFoundException('Compte introuvable.');

    return {
      id: ligne.id,
      telephone: formaterTelephone(ligne.telephone),
      role: ligne.role as RoleCompte,
      telephoneVerifie: ligne.telephone_verifie,
      autorite: ligne.autorite_id
        ? { id: ligne.autorite_id, nom: ligne.autorite_nom }
        : null,
      chauffeur: ligne.chauffeur_id
        ? {
            id: ligne.chauffeur_id,
            nom: ligne.nom,
            prenom: ligne.prenom,
            statut: ligne.statut,
            referenceLicence: ligne.reference_licence,
            photoUrl: ligne.photo_chemin
              ? `/media/photos/${ligne.photo_chemin}`
              : null,
          }
        : null,
    };
  }

  /**
   * Création d'un compte agent. Réservée au superadmin : c'est le geste
   * qui donne à quelqu'un le pouvoir de certifier des chauffeurs, il ne
   * doit jamais être accessible autrement.
   */
  async creerAgent(dto: { telephone: string; autoriteId: string; motDePasse?: string },
                   auteurCompteId: string) {
    const telephone = this.exigerTelephone(dto.telephone);

    const autorite = await this.base.premier(
      'SELECT id FROM autorite WHERE id = $1 AND actif', [dto.autoriteId],
    );
    if (!autorite) throw new BadRequestException('Autorité inconnue ou inactive.');

    return this.base.transaction(async (client) => {
      const existant = await client.query(
        'SELECT 1 FROM compte WHERE telephone = $1', [telephone],
      );
      if (existant.rowCount) {
        throw new ConflictException('Ce numéro est déjà enregistré.');
      }

      const hash = dto.motDePasse ? await bcrypt.hash(dto.motDePasse, 12) : null;

      const compte = await client.query(
        `INSERT INTO compte (telephone, mot_de_passe_hash, role, autorite_id)
         VALUES ($1, $2, 'agent', $3) RETURNING id`,
        [telephone, hash, dto.autoriteId],
      );

      await client.query(
        `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
         VALUES ($1, 'agent.cree', 'compte', $2, $3)`,
        [auteurCompteId, compte.rows[0].id, JSON.stringify({ autoriteId: dto.autoriteId })],
      );

      this.logger.log(`Compte agent créé : ${telephone} (autorité ${dto.autoriteId})`);

      return { id: compte.rows[0].id, telephone: formaterTelephone(telephone), role: 'agent' };
    });
  }

  private async delivrerJeton(compteId: string, methode: string) {
    const compte = await this.base.premier<{
      id: string; role: RoleCompte; autorite_id: string | null;
    }>(
      'SELECT id, role, autorite_id FROM compte WHERE id = $1', [compteId],
    );
    if (!compte) throw new UnauthorizedException('Compte introuvable.');

    const charge: ChargeJeton = {
      sub: compte.id,
      role: compte.role,
      autoriteId: compte.autorite_id,
    };

    await this.base.requete(
      `INSERT INTO journal_audit (compte_id, action, entite, entite_id, details)
       VALUES ($1, 'compte.connexion', 'compte', $1, $2)`,
      [compte.id, JSON.stringify({ methode })],
    );

    return {
      jeton: await this.jwt.signAsync(charge),
      expiration: this.config.get<string>('JWT_EXPIRATION', '7d'),
      profil: await this.profil(compte.id),
    };
  }

  private exigerTelephone(saisie: string): string {
    const telephone = normaliserTelephone(saisie);
    if (!telephone) {
      throw new BadRequestException(
        'Numéro invalide. Format attendu : 6XXXXXXXX ou 2XXXXXXXX.',
      );
    }
    return telephone;
  }
}
