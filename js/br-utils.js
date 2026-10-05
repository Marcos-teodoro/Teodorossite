/* Máscaras, validação (CPF/CNPJ, WhatsApp) e busca de CEP — usado no cadastro e no checkout.
 * A validação definitiva é feita no servidor; aqui é para o cliente corrigir na hora. */
(function (global) {
  'use strict';

  const digits = (v) => String(v || '').replace(/\D/g, '');

  function isValidCpf(raw) {
    const d = digits(raw);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (const size of [9, 10]) {
      let total = 0;
      for (let i = 0; i < size; i += 1) total += Number(d[i]) * (size + 1 - i);
      if (((total * 10) % 11) % 10 !== Number(d[size])) return false;
    }
    return true;
  }

  function isValidCnpj(raw) {
    const d = digits(raw);
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const calc = (size) => {
      const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let total = 0;
      for (let i = 0; i < size; i += 1) total += Number(d[i]) * weights[i];
      return total % 11 < 2 ? 0 : 11 - (total % 11);
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }

  // allowCnpj=false: só CPF (cadastro). true: CPF ou CNPJ (checkout).
  function docError(raw, allowCnpj) {
    const d = digits(raw);
    if (!d) return 'Informe o CPF.';
    if (d.length === 11) return isValidCpf(d) ? '' : 'CPF inválido. Confira os números.';
    if (allowCnpj && d.length === 14) return isValidCnpj(d) ? '' : 'CNPJ inválido. Confira os números.';
    return allowCnpj ? 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).' : 'O CPF deve ter 11 dígitos.';
  }

  function phoneError(raw) {
    let d = digits(raw);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return 'WhatsApp inválido. Informe o DDD e o número.';
    if (Number(d.slice(0, 2)) < 11 || d[0] === '0') return 'DDD do WhatsApp inválido.';
    if (d.length === 11 && d[2] !== '9') return 'Celular inválido: depois do DDD o número começa com 9.';
    return '';
  }

  function maskDoc(el) {
    const d = digits(el.value).slice(0, 14);
    el.value = d.length <= 11
      ? d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
      : d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }

  function maskCpf(el) {
    const d = digits(el.value).slice(0, 11);
    el.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function formatPhone(raw) {
    let d = digits(raw);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length > 10) return d.replace(/(\d{2})(\d{5})(\d{1,4})$/, '($1) $2-$3');
    return d.replace(/(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3').replace(/-$/, '');
  }

  function maskPhone(el) {
    el.value = formatPhone(el.value);
  }

  function maskCep(el) {
    const d = digits(el.value).slice(0, 8);
    el.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  // Busca o endereço pelo CEP na API da loja (CepCerto, com ViaCEP de reserva).
  async function lookupCep(cep) {
    const d = digits(cep);
    if (d.length !== 8) throw new Error('CEP inválido (8 dígitos).');
    return global.TeodoraAPI.api(`/api/shipping/cep/${d}`);
  }

  global.BrUtils = {
    digits, isValidCpf, isValidCnpj, docError, phoneError,
    maskDoc, maskCpf, maskPhone, maskCep, formatPhone, lookupCep,
  };
})(window);
