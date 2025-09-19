# MongoDB Authentication Error - Troubleshooting Guide

## Error Description
```
MongoServerError: bad auth : Authentication failed.
code: 8000, codeName: 'AtlasError'
```

## Root Cause
The MongoDB Atlas authentication is failing due to incorrect credentials or configuration issues.

## Solution Steps

### 1. Verify MongoDB Atlas Credentials

**Check Database Access:**
1. Go to [MongoDB Atlas Dashboard](https://cloud.mongodb.com/)
2. Select your project and cluster
3. Navigate to **Database Access** in the left sidebar
4. Verify that the username exists and has the correct permissions
5. If the user doesn't exist, create a new database user:
   - Click "Add New Database User"
   - Choose "Password" authentication
   - Set username and password
   - Grant "readWrite" role for the `sooki_marketplace` database

**Reset Password (if needed):**
1. In Database Access, click "Edit" next to your user
2. Click "Edit Password"
3. Generate a new secure password
4. Update your `.env` file with the new credentials

### 2. Check Network Access

1. Navigate to **Network Access** in MongoDB Atlas
2. Ensure your current IP address is whitelisted
3. For testing purposes, you can temporarily add `0.0.0.0/0` (allow access from anywhere)
4. **Important:** Remove `0.0.0.0/0` in production and use specific IP addresses

### 3. Verify Cluster Information

1. Go to **Clusters** in MongoDB Atlas
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string and compare with your configuration:
   - Cluster URL should match: `cluster0.qnwvegm.mongodb.net`
   - Database name: `sooki_marketplace`

### 4. Update Environment Variables

Edit your `.env` file with the correct credentials:

```env
# Replace with your actual MongoDB Atlas credentials
MONGO_USERNAME=your_actual_username
MONGO_PASSWORD=your_actual_password
MONGO_CLUSTER=cluster0.qnwvegm.mongodb.net
MONGO_DATABASE=sooki_marketplace
MONGO_APP_NAME=Cluster0
```

### 5. Test Connection

**Option A: Test with MongoDB Compass**
1. Download [MongoDB Compass](https://www.mongodb.com/products/compass)
2. Use the same connection string to test connectivity
3. Format: `mongodb+srv://username:password@cluster0.qnwvegm.mongodb.net/sooki_marketplace`

**Option B: Test with Node.js**
```bash
cd d:\Projects\sooki_experiment\lib\backend
node index.js
```

### 6. Common Issues and Solutions

**Issue: User doesn't exist**
- Solution: Create a new database user in MongoDB Atlas

**Issue: Incorrect password**
- Solution: Reset password in Database Access settings

**Issue: Insufficient permissions**
- Solution: Grant `readWrite` role for the `sooki_marketplace` database

**Issue: IP not whitelisted**
- Solution: Add your IP address to Network Access whitelist

**Issue: Cluster is paused/stopped**
- Solution: Resume the cluster in MongoDB Atlas

**Issue: Wrong cluster URL**
- Solution: Verify the cluster connection string in Atlas

### 7. Security Best Practices

1. **Never commit credentials to version control**
   - Add `.env` to your `.gitignore` file
   - Use environment variables in production

2. **Use strong passwords**
   - Minimum 12 characters
   - Mix of uppercase, lowercase, numbers, and symbols

3. **Limit IP access**
   - Only whitelist necessary IP addresses
   - Avoid using `0.0.0.0/0` in production

4. **Regular credential rotation**
   - Change passwords periodically
   - Monitor database access logs

### 8. Alternative Connection Methods

If the issue persists, try these alternatives:

**Method 1: MongoDB Atlas (recommended)**
```env
MONGO_URI=mongodb+srv://username:password@cluster0.qnwvegm.mongodb.net/sooki_marketplace?retryWrites=true&w=majority&appName=Cluster0
```

**Note: Local MongoDB is no longer supported. Use MongoDB Atlas for all environments.**

### 9. Debugging Steps

1. **Enable MongoDB debug logging:**
   ```javascript
   // Add to your index.js
   import { MongoClient } from 'mongodb';
   
   const client = new MongoClient(MONGO_URI, {
     monitorCommands: true
   });
   
   client.on('commandStarted', (event) => {
     console.log('Command started:', event.commandName);
   });
   ```

2. **Test individual components:**
   ```javascript
   // Test if environment variables are loaded
   console.log('Username:', process.env.MONGO_USERNAME);
   console.log('Cluster:', process.env.MONGO_CLUSTER);
   console.log('Database:', process.env.MONGO_DATABASE);
   // Don't log the password for security
   ```

### 10. Contact Support

If none of the above solutions work:
1. Check MongoDB Atlas status page
2. Contact MongoDB Atlas support
3. Verify your Atlas subscription is active

---

## Quick Checklist

- [ ] Verified username exists in Database Access
- [ ] Confirmed password is correct
- [ ] Checked user has readWrite permissions
- [ ] IP address is whitelisted in Network Access
- [ ] Cluster is running and accessible
- [ ] Updated .env file with correct credentials
- [ ] Tested connection with MongoDB Compass
- [ ] Verified cluster URL matches configuration

Once you've completed these steps, run `node index.js` again to test the connection.