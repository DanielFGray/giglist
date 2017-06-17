// @flow
import React from 'react'
import { Menu } from 'semantic-ui-react'
import { Link } from 'react-router-dom'

const Nav = () =>
  <nav style={{ padding: '10px 10px 0 10px' }}>
    <Menu>
      <Menu.Item as={Link} to="/">Home</Menu.Item>
      <Menu.Menu position="right">
        <Menu.Item as={Link} to="/signin">Sign In</Menu.Item>
      </Menu.Menu>
    </Menu>
  </nav>

export default Nav
