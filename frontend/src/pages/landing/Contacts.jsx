//frontend/src/pages/landing/Contacts.jsx

export default function Contacts(){
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">Контакты</h1>
      <div className="mt-4 space-y-2">
        <div><b>Телефон:</b> +998 XX XXX XX XX</div>
        <div><b>WhatsApp:</b> <a className="text-[#FF5722]" href="https://wa.me/XXXXXXXXXXX">написать</a></div>
        <div><b>Telegram:</b> <a className="text-[#FF5722]" href="https://t.me/XXXXXXXX">написать</a></div>
        <div><b>Адрес:</b> Ташкент, ...</div>
      </div>
    </main>
  );
}
