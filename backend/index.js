
const express = require("express");
const cors = require("cors");
const app = express();
const providerRoutes = require("./routes/providerRoutes");
const clientRoutes = require("./routes/clientRoutes");

require("dotenv").config();
app.use(cors());
app.use(express.json());

app.use("/api/providers", providerRoutes);
app.use("/api/clients", clientRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
