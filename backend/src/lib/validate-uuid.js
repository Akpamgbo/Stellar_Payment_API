/**
 * Express middleware that validates the `:id` route parameter is a well-formed UUID v4.
 * Returns 400 immediately if the format is wrong, preventing DB errors downstream.
 *
 * Usage:
 *   import { validateUuidParam } from '../lib/validate-uuid.js';
 *   router.get('/resource/:id', validateUuidParam(), handler);
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} [param='id'] - The route param name to validate (default: 'id')
 */
export function validateUuidParam(param = 'id') {
  return function (req, res, next) {
    const value = req.params[param];
    if (!UUID_REGEX.test(value)) {
      return res.status(400).json({
        error: `Invalid ${param}: must be a valid UUID v4`,
      });
    }
    next();
  };
}
