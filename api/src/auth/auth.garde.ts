import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { RoleCompte } from './auth.service';
import { CompteAuthentifie } from './jwt.strategie';

/** Exige un jeton valide. */
@Injectable()
export class JwtGarde extends AuthGuard('jwt') {}

export const CLE_ROLES = 'roles_requis';

/** Restreint une route à certains rôles : @Roles('agent', 'superadmin'). */
export const Roles = (...roles: RoleCompte[]) => SetMetadata(CLE_ROLES, roles);

/**
 * Vérifie le rôle. À utiliser toujours **après** JwtGarde :
 * @UseGuards(JwtGarde, RolesGarde).
 */
@Injectable()
export class RolesGarde implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexte: ExecutionContext): boolean {
    const requis = this.reflector.getAllAndOverride<RoleCompte[]>(CLE_ROLES, [
      contexte.getHandler(),
      contexte.getClass(),
    ]);
    if (!requis?.length) return true;

    const compte: CompteAuthentifie | undefined =
      contexte.switchToHttp().getRequest().user;

    if (!compte || !requis.includes(compte.role)) {
      throw new ForbiddenException(
        'Votre compte n\'a pas les droits nécessaires pour cette action.',
      );
    }
    return true;
  }
}

/**
 * Injecte le compte porteur du jeton.
 * `@CompteConnecte() compte: CompteAuthentifie` — ou un champ précis :
 * `@CompteConnecte('id') compteId: string`.
 */
export const CompteConnecte = createParamDecorator(
  (champ: keyof CompteAuthentifie | undefined, contexte: ExecutionContext) => {
    const compte: CompteAuthentifie = contexte.switchToHttp().getRequest().user;
    return champ ? compte?.[champ] : compte;
  },
);
