// Form validation.

export function isValidEmail(value) {
  return /^[a-z0-9.]+@[a-z0-9-]+\.[a-z]+$/i.test(value.trim());
}
