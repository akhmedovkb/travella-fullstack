import { useEffect, useState } from "react";

const ClientDashboard = () => {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      const res = await fetch("https://travella-api.up.railway.app/api/clients/profile", {
        headers: {
          Authorization: "Bearer " + localStorage.getItem("clientToken"),
        },
      });
      const data = await res.json();
      setProfile(data);
    };
    fetchProfile();
  }, []);

  if (!profile) return <div>Загрузка...</div>;

  return (
    <div style={{ padding: "2rem" }}>
      <h2>Клиент: {profile.name}</h2>
      <p>Email: {profile.email}</p>
    </div>
  );
};

export default ClientDashboard;
