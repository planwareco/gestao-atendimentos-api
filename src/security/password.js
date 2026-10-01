/**
 * Hash de senha com Argon2id (recomendação OWASP).
 */
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Hash "falso" usado quando o e-mail não existe, para o tempo de resposta
// do login ser igual (evita enumeração de usuários por timing).
let dummyHash;
export async function burnPasswordCheck(plain) {
  dummyHash ??= await hashPassword('senha-inexistente-para-timing-123');
  await verifyPassword(dummyHash, plain);
  return false;
}
