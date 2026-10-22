const REGISTRATION_CALLBACK_RE = /^(?:role:(?:client|provider)|provider_type:(?:agent|guide|transport|hotel|back))$/;

function isRegistrationCallbackData(value) {
  return REGISTRATION_CALLBACK_RE.test(String(value || ""));
}

module.exports = { isRegistrationCallbackData };
