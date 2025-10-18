import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary from environment variables. This file should NOT contain
// hardcoded credentials in source control for production. Fallback values are
// intentionally benign placeholders to ease local development if .env isn't set.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUD_NAME',
  api_key: process.env.CLOUDINARY_API_KEY || 'YOUR_API_KEY',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'YOUR_API_SECRET'
});

export default cloudinary;