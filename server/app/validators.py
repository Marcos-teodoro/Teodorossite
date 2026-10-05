"""Validação e normalização de dados brasileiros (CPF/CNPJ, WhatsApp, CEP).

Mercado Pago e CepCerto exigem CPF/CNPJ e telefone corretos; validamos aqui, no servidor,
porque o navegador pode ser contornado.
"""
from __future__ import annotations

import re


def only_digits(value: object) -> str:
    return re.sub(r"\D", "", str(value or ""))


def is_valid_cpf(digits: str) -> bool:
    if len(digits) != 11 or digits == digits[0] * 11:
        return False
    for size in (9, 10):
        total = sum(int(digits[i]) * (size + 1 - i) for i in range(size))
        check = (total * 10) % 11 % 10
        if check != int(digits[size]):
            return False
    return True


def is_valid_cnpj(digits: str) -> bool:
    if len(digits) != 14 or digits == digits[0] * 14:
        return False
    for size in (12, 13):
        weights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][-size:] if size == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        total = sum(int(digits[i]) * weights[i] for i in range(size))
        check = 0 if total % 11 < 2 else 11 - total % 11
        if check != int(digits[size]):
            return False
    return True


def normalize_doc(raw: object) -> str:
    """Devolve só dígitos de um CPF ou CNPJ válido; ValueError caso contrário."""
    digits = only_digits(raw)
    if len(digits) == 11:
        if not is_valid_cpf(digits):
            raise ValueError("CPF inválido. Confira os números digitados.")
        return digits
    if len(digits) == 14:
        if not is_valid_cnpj(digits):
            raise ValueError("CNPJ inválido. Confira os números digitados.")
        return digits
    raise ValueError("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).")


def normalize_cpf(raw: object) -> str:
    digits = only_digits(raw)
    if len(digits) != 11 or not is_valid_cpf(digits):
        raise ValueError("CPF inválido. Confira os números digitados.")
    return digits


def normalize_phone(raw: object) -> str:
    """WhatsApp brasileiro com DDD: 10 (fixo) ou 11 dígitos (celular, começa com 9)."""
    digits = only_digits(raw)
    if len(digits) in (12, 13) and digits.startswith("55"):
        digits = digits[2:]
    if len(digits) not in (10, 11):
        raise ValueError("WhatsApp inválido. Informe o DDD e o número, ex.: (11) 99999-8888.")
    if not 11 <= int(digits[:2]) <= 99 or digits[0] == "0":
        raise ValueError("DDD do WhatsApp inválido.")
    if len(digits) == 11 and digits[2] != "9":
        raise ValueError("Celular inválido: com 11 dígitos o número começa com 9 depois do DDD.")
    return digits


def normalize_cep(raw: object) -> str:
    digits = only_digits(raw)
    if len(digits) != 8:
        raise ValueError("CEP inválido (8 dígitos).")
    return digits
