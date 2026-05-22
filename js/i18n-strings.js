/**
 * i18n string tables for Spanish and Russian pages.
 *
 * Loaded only on /es/ and /ru/ pages. Consumed by component-loader.js
 * (applyI18n) and form-validation.js (t helper).
 *
 * Populated by scripts/build-translations.js. Keys must match the
 * data-i18n / data-i18n-placeholder / data-i18n-aria-label attributes
 * in components/contact-modal.html and the validation keys in
 * js/form-validation.js.
 */
window.I18N = window.I18N || {};

window.I18N.es = {
    'modal.floatingBtn.ariaLabel': 'Bank on Frank',
    'modal.floatingBtn.label': 'Bank on Frank',
    'modal.close.ariaLabel': 'Cerrar ventana',
    'modal.noFees': 'Sin honorarios a menos que ganemos',
    'modal.name.label': 'Nombre completo',
    'modal.name.placeholder': 'Su nombre completo',
    'modal.email.label': 'Correo electrónico',
    'modal.email.placeholder': 'su@correo.com',
    'modal.phone.label': 'Número de teléfono',
    'modal.phone.placeholder': '(555) 123-4567',
    'modal.message.label': '¿Cómo podemos ayudarle?',
    'modal.message.placeholder': 'Describa su situación...',
    'modal.submit': 'Bank on Frank',
    'modal.disclaimer': 'Sin honorarios a menos que ganemos. Su información es confidencial.',
    'validation.email': 'Por favor ingrese un correo electrónico válido',
    'validation.phone': 'Por favor ingrese un número de teléfono válido',
    'validation.messageMin': 'Por favor proporcione más detalles sobre su caso',
    'validation.required.name': 'Por favor ingrese su nombre completo',
    'validation.required.firm_name': 'Por favor ingrese el nombre de su firma',
    'validation.required.email': 'Por favor ingrese su correo electrónico',
    'validation.required.phone': 'Por favor ingrese su número de teléfono',
    'validation.required.message': 'Por favor díganos cómo podemos ayudarle',
    'validation.required.default': 'Este campo es obligatorio'
};

window.I18N.ru = {
    'modal.floatingBtn.ariaLabel': 'Bank on Frank',
    'modal.floatingBtn.label': 'Bank on Frank',
    'modal.close.ariaLabel': 'Закрыть окно',
    'modal.noFees': 'Без оплаты, пока мы не выиграем',
    'modal.name.label': 'Полное имя',
    'modal.name.placeholder': 'Ваше полное имя',
    'modal.email.label': 'Электронная почта',
    'modal.email.placeholder': 'ваш@email.com',
    'modal.phone.label': 'Номер телефона',
    'modal.phone.placeholder': '(555) 123-4567',
    'modal.message.label': 'Чем мы можем помочь?',
    'modal.message.placeholder': 'Опишите вашу ситуацию...',
    'modal.submit': 'Bank on Frank',
    'modal.disclaimer': 'Без оплаты, пока мы не выиграем. Ваша информация конфиденциальна.',
    'validation.email': 'Пожалуйста, введите действительный адрес электронной почты',
    'validation.phone': 'Пожалуйста, введите действительный номер телефона',
    'validation.messageMin': 'Пожалуйста, предоставьте больше информации о вашем деле',
    'validation.required.name': 'Пожалуйста, введите ваше полное имя',
    'validation.required.firm_name': 'Пожалуйста, введите название вашей фирмы',
    'validation.required.email': 'Пожалуйста, введите ваш адрес электронной почты',
    'validation.required.phone': 'Пожалуйста, введите ваш номер телефона',
    'validation.required.message': 'Пожалуйста, расскажите, как мы можем помочь',
    'validation.required.default': 'Это поле обязательно для заполнения'
};
