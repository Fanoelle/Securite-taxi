import { Controller, Post, Get, Body, HttpCode, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtGarde, RolesGarde, Roles, CompteConnecte } from './auth.garde';
import {
  DemandeOtpDto, VerificationOtpDto, ConnexionMotDePasseDto, CreationAgentDto,
} from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Chaque code envoyé coûte un SMS. La limite de débit est la première
   * défense contre quelqu'un qui viderait le budget en boucle.
   */
  @Post('otp/demande')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: 'Demander un code de connexion par SMS' })
  async demanderOtp(@Body() dto: DemandeOtpDto) {
    return this.auth.demanderOtp(dto.telephone);
  }

  @Post('otp/verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Verifier le code et obtenir un jeton' })
  @ApiResponse({ status: 401, description: 'Code incorrect ou expire' })
  async verifierOtp(@Body() dto: VerificationOtpDto) {
    return this.auth.verifierOtp(dto.telephone, dto.code);
  }

  /** Réservé aux agents et administrateurs, qui travaillent sur poste fixe. */
  @Post('connexion')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Connexion par mot de passe (agents)' })
  @ApiResponse({ status: 401, description: 'Numero ou mot de passe incorrect' })
  async connexion(@Body() dto: ConnexionMotDePasseDto) {
    return this.auth.connexionMotDePasse(dto.telephone, dto.motDePasse);
  }

  @Get('moi')
  @UseGuards(JwtGarde)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil du compte connecte' })
  async moi(@CompteConnecte('id') compteId: string) {
    return this.auth.profil(compteId);
  }

  /** Donner à quelqu'un le pouvoir de certifier des chauffeurs. */
  @Post('agents')
  @HttpCode(201)
  @UseGuards(JwtGarde, RolesGarde)
  @Roles('superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Creer un compte agent (superadmin uniquement)' })
  @ApiResponse({ status: 403, description: 'Reserve au superadmin' })
  async creerAgent(@Body() dto: CreationAgentDto, @CompteConnecte('id') auteurId: string) {
    return this.auth.creerAgent(dto, auteurId);
  }
}
