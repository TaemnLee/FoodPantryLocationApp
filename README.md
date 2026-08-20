# Licking County Food Pantry Network

A mobile application developed with the **Licking County Food Pantry Network** to help community members find nearby food pantries and access up-to-date information about their services.

The app brings pantry locations, operating hours, available food categories, and announcements into a single, accessible mobile experience.

## Features

### Find Nearby Pantries

Explore food pantry locations through an interactive map and search for pantries by name or location.

Each pantry provides information including:

- Address and location
- Current operating status
- Hours of operation
- Seasonal availability
- Available food categories
- Temporary closures

### Stay Updated

The announcements system provides users with current information about:

- Pantry closures
- Schedule changes
- Events
- General updates

Announcements can be network-wide or associated with individual pantries.

### Real-Time Information

Pantry information is synchronized with the backend using **Supabase Realtime**, allowing updates made by administrators to appear in the app without requiring users to manually refresh.

### Administrative Management

Authorized administrators can manage pantry information directly through the app, including:

- Pantry locations and addresses
- Operating hours
- Seasonal availability
- Inventory information
- Announcements

## Screenshots

<!-- Add screenshots or a short demo video here -->

## Technology

| Area | Technology |
|---|---|
| Mobile Framework | React Native / Expo |
| Language | TypeScript |
| Navigation | Expo Router |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Maps | React Native Maps |
| Mapping APIs | Google Maps / Apple Maps |
| Realtime Data | Supabase Realtime |
| Testing | Jest |

## Architecture

The application follows a client–backend architecture built around React Native and Supabase.

```text
┌─────────────────────────────┐
│      React Native App       │
│                             │
│  Home · Map · Announcements │
│         · Admin             │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│           Supabase          │
│                             │
│  PostgreSQL · Auth · RLS    │
│         · Realtime          │
└──────────────┬──────────────┘
               │
               ▼
      Pantry Network Data

```
The application uses PostgreSQL for structured pantry data, Supabase Auth and Row-Level Security for administrative access, and Supabase Realtime to synchronize changes with connected clients.

## System Documentation

For detailed technical documentation, see:
```
SYSTEM_DOCS.md
```
The system documentation covers:
- Development environment setup
- Application architecture
- Database schema
- Key files and components
- Authentication and admin access
- Pantry visibility and operating-status logic
- Realtime data synchronization
- Utility scripts
- Deployment and EAS configuration

## Project Context

This project was developed as a Software Engineering project at Denison University in collaboration with the Licking County Food Pantry Network.

The project focused on building a practical technology solution for a community partner while applying software engineering principles across mobile development, backend systems, database design, testing, and deployment.

## Team
**Bach Nguyen · Taemin Lee · Dev Manghat · Cheryl Nguyen · Hieu Tran**

## License
This project was developed for the Licking County Food Pantry Network of Ohio, USA and Denison University.
