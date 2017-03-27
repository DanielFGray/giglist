import React, { Component, PropTypes } from 'react'
import marked from 'marked'
import {
  Loader,
  Button,
  Card,
} from 'semantic-ui-react'

import './MainList.css'

const ListItem = props =>
  <Card id={`list_${props.id}`}>
    <Card.Content>
      <div dangerouslySetInnerHTML={{ __html: marked(props.list) }} />
    </Card.Content>
    <Card.Content extra>
      {[
        { content: 'View', url: 'view', color: 'blue', icon: 'unhide' },
        { content: 'Edit', url: 'edit', color: 'green', icon: 'edit' },
        { content: 'Share', url: 'share', color: 'yellow', icon: 'send' },
      ].map(e =>
        <Button
          key={e.label}
          {...e}
          href={`/#/${e.url}/${props.id}`}
          size="tiny"
        />
      )}
    </Card.Content>
  </Card>

ListItem.propTypes = {
  id: PropTypes.number.isRequired,
  list: PropTypes.string.isRequired,
}

export default class MainList extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {},
    }
  }

  componentDidMount() {
    fetch('/api/v1/list')
      .then(response => response.json())
      .then(data => data.body)
      .then(data => this.setState({ data }))
  }

  render() {
    const { data } = this.state

    marked.setOptions({
      gfm: true,
      tables: true,
      breaks: true,
      pedantic: false,
      sanitize: true,
      smartLists: true,
      smartypants: false,
    })

    return (
      <div style={{ padding: '10px' }}>
        <div style={{ paddingBottom: '10px' }}>
          <Button color="green" href="/#/new" icon="write" content="New" />
        </div>

        <Card.Group doubling>
          {data.length > 0
          ? data.map(e => <ListItem key={e.id} {...e} />)
          : <Loader inverted inline="centered" indeterminate>Loading</Loader>}
        </Card.Group>
      </div>
    )
  }
}
