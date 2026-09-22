/**
 * PasswordService
 *
 * Wraps the `argon2` package (native, actively maintained) for hashing and
 * verifying Trustfabric-managed Customer Admin passwords. Argon2id is used —
 * the OWASP-recommended default, resistant to both GPU cracking and
 * side-channel attacks. No hashing is implemented by hand.
 */

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, { type: argon2.argon2id });
  }

  /** Returns false on any mismatch or malformed hash — never throws for bad input. */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }
}
