import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { BaseService } from '../base/base.service';
import { ChargeJeton, RoleCompte } from './auth.service';

/** Ce que les contrôleurs reçoivent via @CompteConnecte(). */
export interface CompteAuthentifie {
  id: string;
  role: RoleCompte;
  autoriteId: string | null;
}

@Injectable()
export class JwtStrategie extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly base: BaseService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret || secret === 'changer-cette-valeur-en-production') {
      throw new Error(
        'JWT_SECRET absent ou laissé à sa valeur d\'exemple. ' +
        'Définissez-le dans .env avant de démarrer.',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Le rôle est relu en base à chaque requête plutôt que pris dans le
   * jeton. Un agent révoqué ou un compte suspendu perd ses droits
   * immédiatement, sans attendre l'expiration de son jeton — sur une
   * plateforme où un agent certifie des chauffeurs, ce délai serait
   * inacceptable.
   */
  async validate(charge: ChargeJeton): Promise<CompteAuthentifie> {
    const compte = await this.base.premier<{
      id: string; role: RoleCompte; autorite_id: string | null;
    }>(
      'SELECT id, role, autorite_id FROM compte WHERE id = $1 AND actif',
      [charge.sub],
    );

    if (!compte) {
      throw new UnauthorizedException('Compte désactivé ou supprimé.');
    }

    return { id: compte.id, role: compte.role, autoriteId: compte.autorite_id };
  }
}
